"""Router-level smoke test for admin auth-gating and basic listing.

Requires a reachable Postgres test database and Redis; skips automatically
when neither is available (see conftest.py).
"""
from app.core.security import hash_password
from app.models import Role, User


async def _create_admin(db_session, phone="+998909998877"):
    admin = User(
        first_name="Admin",
        last_name="User",
        phone_number=phone,
        password_hash=hash_password("AdminPass1!"),
        role=Role.ADMIN,
    )
    db_session.add(admin)
    await db_session.commit()
    return admin


async def test_admin_endpoints_require_admin_role(client):
    await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Reg",
            "last_name": "Ular",
            "phone_number": "+998901231231",
            "password": "Passw0rd!",
            "confirm_password": "Passw0rd!",
        },
    )
    await client.post(
        "/api/v1/auth/login",
        json={"phone_number": "+998901231231", "password": "Passw0rd!"},
    )
    resp = await client.get("/api/v1/admin/overview")
    assert resp.status_code == 403


async def test_admin_overview_and_tests_list(client, db_session):
    await _create_admin(db_session)
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"phone_number": "+998909998877", "password": "AdminPass1!"},
    )
    assert login_resp.status_code == 200

    overview_resp = await client.get("/api/v1/admin/overview")
    assert overview_resp.status_code == 200
    assert set(overview_resp.json()) == {"students", "attempts", "tests", "pending_submissions"}

    tests_resp = await client.get("/api/v1/admin/tests")
    assert tests_resp.status_code == 200
    assert tests_resp.json() == []
