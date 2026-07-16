"""Import the full Road Map corpus: every level, Mid+End, all variants —
questions via AI, answers from each level's key, audio attached, publish.
Already-filled variants are skipped, so the script is safe to re-run."""
import re
import sys
from pathlib import Path

import httpx

from app.core.config import settings

SRC = Path("/tmp/import-src")
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

client = httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=1200.0)
client.post("/auth/login", json={"phone_number": settings.admin_phone, "password": settings.admin_password}).raise_for_status()

levels = {lv["name"]: lv for lv in client.get("/levels").json()}
exam_types = {et["slug"]: et for et in client.get(f"/levels/{list(levels.values())[0]['slug']}/exam-types").json()}

def log(*parts):
    print(*parts, flush=True)

def existing_tests():
    return client.get("/admin/tests").json()

report = {"published": [], "draft": [], "skipped": [], "failed": []}

for level_dir in sorted(SRC.iterdir()):
    if not level_dir.is_dir():
        continue
    level_name = level_dir.name
    if level_name not in levels:
        log(f"!! unknown level folder: {level_name}")
        continue
    inner = level_dir / level_name if (level_dir / level_name).is_dir() else level_dir
    keys = list(inner.glob("Tests_answer_key*.docx"))
    key_path = keys[0] if keys else None

    for exam_folder, et_slug in (("Mid", "mid-course"), ("End", "end-course")):
        exam_dir = inner / exam_folder
        if not exam_dir.is_dir():
            continue
        exam_type = exam_types[et_slug]
        audio_dir = exam_dir / "Audios"
        audios = list(audio_dir.glob("*.mp3")) if audio_dir.is_dir() else []

        for docx in sorted(exam_dir.glob("*.docx")):
            match = re.search(r"V(\d+)", docx.name)
            if not match:
                continue
            number = int(match.group(1))
            title = f"{level_name} {exam_type['name']} — Variant {number}"
            label = f"{level_name}/{exam_folder} V{number}"
            log(f"=== {label} — {docx.name}")

            # Find or create the variant.
            variant = next((t for t in existing_tests()
                            if t["level"] == level_name and t["exam_type"] == exam_type["name"]
                            and t["variant_number"] == number), None)
            if variant and variant["tasks_count"] > 0:
                log(f"    already has {variant['tasks_count']} exercises — skipped")
                report["skipped"].append(label)
                continue
            if not variant:
                r = client.post("/admin/tests", json={
                    "level_id": levels[level_name]["id"], "exam_type_id": exam_type["id"],
                    "title": title, "variant_number": number,
                    "time_limit_minutes": 60, "passing_percentage": 60,
                    "retake_allowed": True, "review_allowed": True,
                })
                if r.status_code != 201:
                    log(f"    !! create failed: {r.status_code} {r.text[:150]}")
                    report["failed"].append(f"{label}: create {r.status_code}")
                    continue
                variant = r.json()
            vid = variant["id"]

            # 1) Questions via AI.
            with open(docx, "rb") as f:
                r = client.post(f"/admin/tests/{vid}/import-docx",
                                files={"file": (docx.name, f, DOCX_MIME)})
            if r.status_code != 201:
                log(f"    !! import-docx failed: {r.status_code} {str(r.text)[:200]}")
                report["failed"].append(f"{label}: import {r.status_code}")
                continue
            created = r.json()
            log(f"    imported {created['created']} exercises, {len(created.get('warnings', []))} warnings")

            # 2) Answers from the level key.
            if key_path:
                with open(key_path, "rb") as f:
                    r = client.post(f"/admin/tests/{vid}/import-answers",
                                    files={"file": (key_path.name, f, DOCX_MIME)})
                if r.status_code == 200:
                    log(f"    answers updated: {r.json().get('updated')}")
                else:
                    log(f"    !! answers failed: {r.status_code} {str(r.text)[:150]}")

            # 3) Audio: '<...>Mid 1 R2.mp3' → variant 1, Recording 2.
            attach = {}
            for audio in audios:
                m = re.search(r"(?:mid|end)\s*(\d)\s*R(\d)", audio.name, re.I)
                if m and int(m.group(1)) == number:
                    attach[int(m.group(2))] = audio
            if attach:
                detail = client.get(f"/admin/tests/{vid}").json()
                tasks = [t for s in detail["sections"] for t in s["tasks"]]
                for recording, audio in sorted(attach.items()):
                    with open(audio, "rb") as f:
                        up = client.post("/admin/media", files={"file": (audio.name, f, "audio/mpeg")})
                    if up.status_code != 201:
                        log(f"    !! media upload failed: {up.status_code}")
                        continue
                    media_id = up.json()["id"]
                    hits = 0
                    for task in tasks:
                        if re.search(rf"recording\s*{recording}\b", f"{task['title']} {task['instructions']}", re.I):
                            client.patch(f"/admin/tasks/{task['id']}", json={
                                "title": task["title"], "type": task["type"],
                                "instructions": task["instructions"],
                                "passage_html": task.get("passage_html"),
                                "audio_replay_limit": task.get("audio_replay_limit"),
                                "media_asset_id": media_id,
                            })
                            hits += 1
                    log(f"    audio R{recording} ({audio.name}) -> {hits} exercise(s)")
            else:
                log("    no matching audio files")

            # 4) Publish.
            r = client.post(f"/admin/tests/{vid}/publish")
            if r.status_code == 200:
                log("    PUBLISHED")
                report["published"].append(label)
            else:
                detail = r.json().get("detail", {})
                errors = detail.get("errors", []) if isinstance(detail, dict) else []
                log(f"    left DRAFT — {len(errors)} quality issue(s)")
                for issue in errors[:6]:
                    log(f"      - {issue.get('scope')}: {issue.get('message')}")
                report["draft"].append(f"{label} ({len(errors)} issues)")

log("\n===== SUMMARY =====")
for key, items in report.items():
    log(f"{key.upper()} ({len(items)}):")
    for item in items:
        log("  ", item)
