"""Attach every available recording to its listening exercise across all
variants. Handles .mp3 AND .mp4 (uploaded as audio so the audio player with
auto-start is used), matches by level/exam/variant number, and copes with the
Pre-Intermediate End files that carry no variant number (shared recordings)."""
import re
from pathlib import Path

import httpx

from app.core.config import settings

SRC = Path("/tmp/import-src")
c = httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=600.0)
c.post("/auth/login", json={"phone_number": settings.admin_phone, "password": settings.admin_password}).raise_for_status()

LEVEL_DIR = {
    "Beginner": "Beginner/Beginner",
    "Elementary": "Elementary/Elementary",
    "Intermediate": "Intermediate/Intermediate",
    "Pre-Intermediate": "Pre-Intermediate/Pre-Intermediate",
}

def audio_for(level, exam_word, variant, recording):
    """Return the best-matching audio Path for (variant, recording), or None."""
    folder = SRC / LEVEL_DIR[level] / exam_word / "Audios"
    if not folder.is_dir():
        return None
    files = list(folder.iterdir())
    # 1) Named "<...> <Mid|End><variant> R<recording>" (any extension).
    for f in files:
        m = re.search(r"(?:mid|end)\s*(\d)\s*r\s*(\d)", f.stem, re.I)
        if m and int(m.group(1)) == variant and int(m.group(2)) == recording:
            return f
    # 2) Generic recording with no variant (e.g. Pre End "..._R1"/"..._R2"):
    #    shared across that exam's variants.
    for f in files:
        if re.search(rf"(?:^|_)r{recording}\b", f.stem, re.I) and not re.search(r"(?:mid|end)\s*\d", f.stem, re.I):
            return f
    return None

# Cache uploads so a shared recording is uploaded once.
uploaded: dict[str, str] = {}

def upload(path: Path) -> str | None:
    if str(path) in uploaded:
        return uploaded[str(path)]
    # Force an audio mime by giving mp4/mp3 an audio-friendly name so the
    # exam uses the audio player (m4a -> audio/mp4, mp3 -> audio/mpeg).
    name = path.name
    if path.suffix.lower() == ".mp4":
        name = path.stem + ".m4a"
    mime = "audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/mp4"
    with open(path, "rb") as f:
        r = c.post("/admin/media", files={"file": (name, f, mime)})
    if r.status_code != 201:
        print(f"    !! upload xato {r.status_code}: {path.name}")
        return None
    uploaded[str(path)] = r.json()["id"]
    return r.json()["id"]

for t in c.get("/admin/tests").json():
    if t["tasks_count"] == 0:
        continue
    exam_word = "Mid" if "Mid" in t["exam_type"] else "End"
    label = f"{t['level']}/{exam_word} V{t['variant_number']}"
    detail = c.get(f"/admin/tests/{t['id']}").json()
    tasks = [task for s in detail["sections"] for task in s["tasks"]]
    done = 0
    for task in tasks:
        if task.get("media"):
            continue  # already has audio
        blob = f"{task['title']} {task['instructions']}"
        m = re.search(r"recording\s*(\d)", blob, re.I)
        if not m:
            continue
        recording = int(m.group(1))
        audio = audio_for(t["level"], exam_word, t["variant_number"], recording)
        if not audio:
            continue
        media_id = upload(audio)
        if not media_id:
            continue
        r = c.patch(f"/admin/tasks/{task['id']}", json={
            "title": task["title"], "type": task["type"],
            "instructions": task["instructions"],
            "passage_html": task.get("passage_html"),
            "audio_replay_limit": task.get("audio_replay_limit"),
            "media_asset_id": media_id,
        })
        if r.status_code == 200:
            done += 1
            print(f"[{label}] R{recording} <- {audio.name}")
    if done:
        print(f"[{label}] {done} ta audio biriktirildi")
