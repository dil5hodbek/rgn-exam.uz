"""Full readiness report: per variant — status, exercises, answers, audio."""
import re

import httpx

from app.core.config import settings

c = httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=300.0)
c.post("/auth/login", json={"phone_number": settings.admin_phone, "password": settings.admin_password}).raise_for_status()

rows = []
for t in sorted(c.get("/admin/tests").json(), key=lambda x: (x["level"], x["exam_type"], x["variant_number"])):
    label = f"{t['level']}/{t['exam_type'].split()[0]} V{t['variant_number']}"
    if t["tasks_count"] == 0:
        rows.append((label, t["status"], 0, "-", "-", "BO'SH — import kutilmoqda"))
        continue
    detail = c.get(f"/admin/tests/{t['id']}").json()
    tasks = [task for s in detail["sections"] for task in s["tasks"]]
    scored = missing = todo = 0
    for task in tasks:
        manual = task["type"] in ("writing", "speaking_prompt_placeholder", "rich_text_question")
        for q in task["questions"]:
            if q.get("is_example"):
                continue
            scored += 1
            if manual:
                continue
            ca = q.get("correct_answer")
            if ca in (None, "", []):
                missing += 1
            elif str(ca).strip() == "TODO":
                todo += 1
    listening = [task for task in tasks if re.search(r"\brecording\s*\d", f"{task['title']} {task['instructions']}", re.I)]
    with_audio = sum(1 for task in listening if task.get("media"))
    audio_str = f"{with_audio}/{len(listening)}" if listening else "kerak emas"
    answers_ok = missing == 0 and todo == 0
    audio_ok = not listening or with_audio == len(listening)
    if t["status"] == "PUBLISHED" and answers_ok and audio_ok:
        verdict = "TO'LIQ TAYYOR ✓"
    elif t["status"] == "PUBLISHED":
        problems = []
        if not answers_ok:
            problems.append(f"{missing + todo} javob kam/TODO")
        if not audio_ok:
            problems.append("audio kam")
        verdict = "PUBLISHED, lekin: " + ", ".join(problems)
    else:
        verdict = f"DRAFT ({'audio yo`q' if not audio_ok else 'tekshirish kerak'})"
    rows.append((label, t["status"], len(tasks), f"{scored} savol, {missing + todo} muammo", audio_str, verdict))

print(f"{'Variant':30} | {'Holat':9} | {'Mashq':5} | {'Javoblar':22} | {'Audio':10} | Xulosa")
print("-" * 118)
for r in rows:
    print(f"{r[0]:30} | {r[1]:9} | {r[2]:5} | {r[3]:22} | {r[4]:10} | {r[5]}")
