"""Router-level smoke test for the register -> login -> me happy path.

Requires a reachable Postgres test database and Redis (see conftest.py);
skips automatically when neither is available.
"""


async def test_register_login_me(client):
    register_payload = {
        "first_name": "Test",
        "last_name": "Student",
        "phone_number": "+998901234567",
        "password": "Passw0rd!",
        "confirm_password": "Passw0rd!",
    }
    register_resp = await client.post("/api/v1/auth/register", json=register_payload)
    assert register_resp.status_code == 201
    body = register_resp.json()
    assert body["user"]["phone_number"] == "+998901234567"
    assert body["user"]["role"] == "STUDENT"

    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"phone_number": "+998901234567", "password": "Passw0rd!"},
    )
    assert login_resp.status_code == 200

    me_resp = await client.get("/api/v1/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["phone_number"] == "+998901234567"


async def test_login_rejects_wrong_password(client):
    await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Test",
            "last_name": "Student",
            "phone_number": "+998907654321",
            "password": "Passw0rd!",
            "confirm_password": "Passw0rd!",
        },
    )
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"phone_number": "+998907654321", "password": "WrongPass1"},
    )
    assert login_resp.status_code == 401
