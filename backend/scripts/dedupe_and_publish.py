"""Second-pass dedupe: fingerprint each exercise by its question texts (not
its title) so the AI's slightly-different rubric wording can't hide a copy.
Then force reuse_options on flagged matchings and republish."""
import httpx

from app.core.config import settings

c = httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=600.0)
c.post("/auth/login", json={"phone_number": settings.admin_phone, "password": settings.admin_password}).raise_for_status()

def fingerprint(task):
    prompts = sorted(" ".join(q["prompt"].split()).lower() for q in task["questions"])
    return (len(prompts), tuple(prompts[:3]))

published, drafts = [], []

for t in c.get("/admin/tests").json():
    if t["tasks_count"] == 0:
        continue
    label = f"{t['level']}/{t['exam_type'].split()[0]} V{t['variant_number']}"
    detail = c.get(f"/admin/tests/{t['id']}").json()
    tasks = sorted((task for s in detail["sections"] for task in s["tasks"]),
                   key=lambda x: x.get("order_index") or 0)

    seen = {}
    removed = 0
    for task in tasks:
        fp = fingerprint(task)
        if fp in seen:
            r = c.delete(f"/admin/tasks/{task['id']}")
            if r.status_code == 204:
                removed += 1
            else:
                print(f"[{label}] o'chirib bo'lmadi ({r.status_code}): {task['title'][:40]}")
        else:
            seen[fp] = task
    if removed:
        print(f"[{label}] kontent bo'yicha {removed} ta dublikat o'chirildi (endi {len(tasks) - removed} ta)")
        detail = c.get(f"/admin/tests/{t['id']}").json()
        tasks = sorted((task for s in detail["sections"] for task in s["tasks"]),
                       key=lambda x: x.get("order_index") or 0)

    # Matching exercises whose answer letters repeat are reusable by design.
    for task in tasks:
        interaction = task.get("interaction") or {}
        if interaction.get("kind") in ("matching", "matching_headings") and not interaction.get("reuse_options"):
            answers = [str(q.get("correct_answer") or "") for q in task["questions"]]
            if len(answers) != len(set(answers)) or len(interaction.get("options") or []) < len(answers):
                c.patch(f"/admin/tasks/{task['id']}", json={
                    "title": task["title"], "type": task["type"],
                    "instructions": task["instructions"],
                    "passage_html": task.get("passage_html"),
                    "audio_replay_limit": task.get("audio_replay_limit"),
                    "media_asset_id": (task.get("media") or {}).get("id"),
                    "interaction": {**interaction, "reuse_options": True},
                })
                print(f"[{label}] reuse_options yoqildi: {task['title'][:50]}")

    # Republish everything that has content (already-published ones republish
    # cleanly; drafts get their chance).
    if len(tasks) < 10:
        drafts.append(f"{label} (chala: {len(tasks)} mashq)")
        continue
    r = c.post(f"/admin/tests/{t['id']}/publish")
    if r.status_code == 200:
        published.append(f"{label} ({len(tasks)} mashq)")
    else:
        errors = r.json().get("detail", {}).get("errors", [])
        reasons = "; ".join(sorted({e.get("message", "") for e in errors}))[:110]
        drafts.append(f"{label} — {reasons}")

print("\n=== YAKUNIY ===")
print("PUBLISHED:", len(published))
for item in published:
    print("  +", item)
print("DRAFT:", len(drafts))
for item in drafts:
    print("  -", item)
