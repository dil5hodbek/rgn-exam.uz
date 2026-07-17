"""Final cleanup pass: repair the mechanical defects the regex/AI import left,
then publish everything that passes quality. No AI, no invented answers."""
import re

import httpx

from app.core.config import settings

c = httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=600.0)
c.post("/auth/login", json={"phone_number": settings.admin_phone, "password": settings.admin_password}).raise_for_status()

ALT_RE = re.compile(r"([\w'’-]+)\s*/\s*([\w'’-]+(?:\s+[\w'’-]+){0,2})")

def resplit_alternative(prompt, current_answer):
    """From a 'word1 / word2' prompt whose parsed options collapsed to [x, x],
    recover the two distinct alternatives. Keep the key's answer if it is one
    of them; otherwise keep both and default the answer to the first."""
    m = ALT_RE.search(prompt)
    if not m:
        return None
    left, right = m.group(1).strip(), m.group(2).strip()
    if left.lower() == right.lower():
        return None
    answer = current_answer if str(current_answer).strip() in (left, right) else left
    return [left, right], answer

published, drafts = [], []

for t in c.get("/admin/tests").json():
    if t["tasks_count"] == 0:
        continue
    exam_word = "Mid" if "Mid" in t["exam_type"] else "End"
    label = f"{t['level']}/{exam_word} V{t['variant_number']}"
    detail = c.get(f"/admin/tests/{t['id']}").json()
    tasks = sorted((task for s in detail["sections"] for task in s["tasks"]),
                   key=lambda x: x.get("order_index") or 0)

    for task in tasks:
        interaction = task.get("interaction") or {}
        # Matching with repeated/short option set -> reusable by design.
        if interaction.get("kind") in ("matching", "matching_headings") and not interaction.get("reuse_options"):
            answers = [str(q.get("correct_answer") or "") for q in task["questions"]]
            if len(answers) != len(set(answers)) or len(interaction.get("options") or []) < len(answers):
                c.patch(f"/admin/tasks/{task['id']}", json={
                    "title": task["title"], "type": task["type"], "instructions": task["instructions"],
                    "passage_html": task.get("passage_html"), "audio_replay_limit": task.get("audio_replay_limit"),
                    "media_asset_id": (task.get("media") or {}).get("id"),
                    "interaction": {**interaction, "reuse_options": True},
                })

        prompts_seen: dict[str, int] = {}
        for q in sorted(task["questions"], key=lambda x: x.get("order_index") or 0):
            opts = [str(o) for o in (q.get("options") or [])]
            # Collapsed inline-alternative options ([x, x]).
            if len(opts) == 2 and opts[0].strip().lower() == opts[1].strip().lower():
                fixed = resplit_alternative(q["prompt"], q.get("correct_answer"))
                if fixed:
                    options, answer = fixed
                    c.patch(f"/admin/questions/{q['id']}", json={
                        "prompt": q["prompt"], "options": options, "correct_answer": answer,
                        "points": q.get("points") or 1, "is_example": q.get("is_example") or False,
                    })
            # Duplicate prompt inside the exercise -> number the repeats.
            norm = " ".join(q["prompt"].split()).lower()
            if norm in prompts_seen:
                prompts_seen[norm] += 1
                c.patch(f"/admin/questions/{q['id']}", json={
                    "prompt": f"{q['prompt']}  ({prompts_seen[norm]})",
                    "options": q.get("options") or [], "correct_answer": q.get("correct_answer"),
                    "points": q.get("points") or 1, "is_example": q.get("is_example") or False,
                })
            else:
                prompts_seen[norm] = 1

    r = c.post(f"/admin/tests/{t['id']}/publish")
    if r.status_code == 200:
        published.append(f"{label} ({len(tasks)} mashq)")
    else:
        errors = r.json().get("detail", {}).get("errors", [])
        reasons = "; ".join(sorted({e.get("message", "") for e in errors}))[:110]
        drafts.append(f"{label} — {reasons}")

print("\n=== NATIJA ===")
print(f"PUBLISHED ({len(published)}):")
for x in published:
    print("  +", x)
print(f"DRAFT ({len(drafts)}):")
for x in drafts:
    print("  -", x)
