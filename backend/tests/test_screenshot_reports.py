"""A screenshot caught on the exam screen counts as a violation and is shown
to the examiner (and in the Excel export) as its own number."""
import io

from openpyxl import load_workbook

from test_session_time_limit import start_proctored


async def test_screenshot_attempts_reach_the_examiner(client, db_session):
    examiner, exam, session, attempt_id, *_ = await start_proctored(client, db_session)
    try:
        shot = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "screenshot"})).json()
        assert shot["violations"] == 1 and shot["submitted"] is False
        left = (await client.post(f"/api/v1/attempts/{attempt_id}/violation", json={"kind": "blur"})).json()
        assert left["violations"] == 2

        row = (await exam.get(f"/api/v1/examiner/sessions/{session['id']}")).json()["participants"][0]
        assert row["violations"] == 2 and row["screenshots"] == 1

        sheet = load_workbook(io.BytesIO((await exam.get(f"/api/v1/examiner/sessions/{session['id']}/export")).content)).active
        rows = [[cell.value for cell in line] for line in sheet.iter_rows()]
        header = next(index for index, line in enumerate(rows) if line and line[0] == "№")
        assert rows[header][-2:] == ["Chiqishlar", "Skrinshotlar"]
        assert rows[header + 1][-2:] == [2, 1]
    finally:
        await examiner.__aexit__(None, None, None)
