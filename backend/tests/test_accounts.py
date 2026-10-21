"""Staff accounts and roles: the owner manages everything, a barber only their own calendar."""

from uuid import uuid4

import pytest

from tests.test_booking_api import (  # noqa: F401  (admin_headers and mock_email_sending are fixtures)
    admin_headers,
    at,
    book,
    client,
    create_barber,
    create_service,
    future_business_day,
    mock_email_sending,
)

PASSWORD = "barber-password-123"


def create_account(admin_headers: dict[str, str], barber_id: int, username: str | None = None) -> dict:
    response = client.post(
        "/api/v1/accounts",
        json={"username": username or f"barber-{uuid4().hex[:8]}", "password": PASSWORD, "barber_id": barber_id},
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def login(username: str, password: str = PASSWORD):
    return client.post("/api/v1/admin/login", json={"username": username, "password": password})


def headers_for(username: str, password: str = PASSWORD) -> dict[str, str]:
    response = login(username, password)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture
def barber_login(admin_headers) -> tuple[dict, dict, dict[str, str]]:
    """A barber with their own login: (barber, account, auth headers)."""
    barber = create_barber(admin_headers)
    account = create_account(admin_headers, barber["id"])
    return barber, account, headers_for(account["username"])


# ------------------------------------------------------------ logging in ---


def test_owner_creates_a_barber_login(admin_headers) -> None:
    barber = create_barber(admin_headers)

    account = create_account(admin_headers, barber["id"], username=f"  Noah-{uuid4().hex[:6]}  ")

    assert account["role"] == "barber"
    assert account["barber_id"] == barber["id"]
    assert account["username"] == account["username"].strip().lower()  # trimmed and lower-cased
    assert "password" not in account and "password_hash" not in account

    response = login(account["username"])
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "barber"
    assert response.json()["barber_id"] == barber["id"]


def test_me_endpoint_tells_who_is_logged_in(admin_headers, barber_login) -> None:
    barber, account, headers = barber_login

    me = client.get("/api/v1/auth/me", headers=headers).json()
    owner = client.get("/api/v1/auth/me", headers=admin_headers).json()

    assert me == {"username": account["username"], "role": "barber", "barber_id": barber["id"]}
    assert owner["role"] == "owner" and owner["barber_id"] is None


def test_wrong_password_is_rejected(barber_login) -> None:
    _, account, _ = barber_login
    assert login(account["username"], "not-the-password").status_code == 401


@pytest.mark.parametrize(
    ("payload_change", "status"),
    [
        ({"password": "short"}, 422),       # at least 10 characters
        ({"username": "ab"}, 422),          # at least 3 characters
        ({"barber_id": 999999}, 404),       # unknown barber
    ],
)
def test_invalid_accounts_are_rejected(payload_change, status, admin_headers) -> None:
    barber = create_barber(admin_headers)
    payload = {"username": f"barber-{uuid4().hex[:8]}", "password": PASSWORD, "barber_id": barber["id"], **payload_change}

    response = client.post("/api/v1/accounts", json=payload, headers=admin_headers)

    assert response.status_code == status, response.text


def test_duplicate_username_and_second_login_for_same_barber_are_rejected(admin_headers, barber_login) -> None:
    barber, account, _ = barber_login
    other = create_barber(admin_headers)

    same_username = client.post(
        "/api/v1/accounts", json={"username": account["username"], "password": PASSWORD, "barber_id": other["id"]},
        headers=admin_headers,
    )
    same_barber = client.post(
        "/api/v1/accounts", json={"username": f"x-{uuid4().hex[:8]}", "password": PASSWORD, "barber_id": barber["id"]},
        headers=admin_headers,
    )

    assert same_username.status_code == 409, same_username.text
    assert same_barber.status_code == 409, same_barber.text


# ------------------------------------------------- what a barber may do ---


def owner_only_requests(admin_headers) -> list[tuple[str, str, dict | list | None]]:
    """(method, path, body) for every owner-only endpoint."""
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    base = f"/api/v1/barbers/{barber['id']}"
    day = future_business_day()
    return [
        ("post", "/api/v1/barbers", {"name": "Sneaky", "email": f"s-{uuid4().hex[:6]}@example.com"}),
        ("patch", base, {"role": "Owner"}),
        ("post", "/api/v1/services", {"name": f"S-{uuid4().hex[:6]}", "duration_minutes": 30, "price": "1"}),
        ("patch", f"/api/v1/services/{service['id']}", {"price": "1"}),
        ("get", f"{base}/working-hours", None),
        ("put", f"{base}/working-hours", []),
        ("get", f"{base}/time-off", None),
        ("post", f"{base}/time-off", {"starts_at": at(day, "09:00"), "ends_at": at(day, "10:00")}),
        ("delete", f"{base}/time-off/1", None),
        ("get", "/api/v1/accounts", None),
        ("post", "/api/v1/accounts", {"username": f"x-{uuid4().hex[:6]}", "password": PASSWORD, "barber_id": barber["id"]}),
        ("put", "/api/v1/accounts/1/password", {"password": PASSWORD}),
        ("delete", "/api/v1/accounts/1", None),
    ]


def test_barber_gets_403_on_every_owner_only_endpoint(admin_headers, barber_login) -> None:
    _, _, headers = barber_login

    for method, path, body in owner_only_requests(admin_headers):
        kwargs = {"headers": headers} if body is None else {"headers": headers, "json": body}
        response = getattr(client, method)(path, **kwargs)
        assert response.status_code == 403, f"{method.upper()} {path}: {response.status_code} {response.text}"


def test_barber_can_read_names_and_colours_for_the_calendar(barber_login) -> None:
    _, _, headers = barber_login
    assert client.get("/api/v1/admin/barbers", headers=headers).status_code == 200
    assert client.get("/api/v1/admin/services", headers=headers).status_code == 200


def test_barber_sees_only_their_own_bookings(admin_headers, barber_login) -> None:
    barber, _, headers = barber_login
    colleague = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()
    mine = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"), customer_name="My Customer")
    theirs = book(colleague["id"], service["id"], at(day, "10:00"), at(day, "10:30"), customer_name="Their Customer")

    barber_view = client.get("/api/v1/appointments", headers=headers).json()
    owner_view = client.get("/api/v1/appointments", headers=admin_headers).json()

    assert {a["barber_id"] for a in barber_view} == {barber["id"]}
    assert mine.json()["id"] in [a["id"] for a in barber_view]
    assert theirs.json()["id"] not in [a["id"] for a in barber_view]
    assert {mine.json()["id"], theirs.json()["id"]} <= {a["id"] for a in owner_view}


def test_barber_can_cancel_own_booking_but_not_a_colleagues(admin_headers, barber_login) -> None:
    barber, _, headers = barber_login
    colleague = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()
    mine = book(barber["id"], service["id"], at(day, "11:00"), at(day, "11:30")).json()
    theirs = book(colleague["id"], service["id"], at(day, "11:00"), at(day, "11:30")).json()

    own = client.patch(f"/api/v1/appointments/{mine['id']}/cancel", headers=headers)
    other = client.patch(f"/api/v1/appointments/{theirs['id']}/cancel", headers=headers)

    assert own.status_code == 200, own.text
    assert other.status_code == 404, other.text  # same answer as "doesn't exist"
    owner_view = client.get("/api/v1/appointments", headers=admin_headers).json()
    assert next(a for a in owner_view if a["id"] == theirs["id"])["status"] != "cancelled"


def test_barber_sees_only_their_own_schedule(admin_headers, barber_login) -> None:
    barber, _, headers = barber_login
    create_barber(admin_headers)
    day = future_business_day()

    barber_view = client.get(f"/api/v1/barbers/schedules?start={day}&end={day}", headers=headers).json()
    owner_view = client.get(f"/api/v1/barbers/schedules?start={day}&end={day}", headers=admin_headers).json()

    assert [item["barber_id"] for item in barber_view] == [barber["id"]]
    assert len(owner_view) > 1


# ----------------------------------------------- owner manages logins ---


def test_deactivating_a_barber_locks_their_login_immediately(admin_headers, barber_login) -> None:
    barber, account, headers = barber_login

    client.patch(f"/api/v1/barbers/{barber['id']}", json={"active": False}, headers=admin_headers)

    assert client.get("/api/v1/appointments", headers=headers).status_code == 401  # existing token
    assert login(account["username"]).status_code == 401                           # new login


def test_owner_resets_a_barbers_password(admin_headers, barber_login) -> None:
    _, account, _ = barber_login

    response = client.put(
        f"/api/v1/accounts/{account['id']}/password", json={"password": "a-brand-new-password"}, headers=admin_headers,
    )

    assert response.status_code == 204, response.text
    assert login(account["username"]).status_code == 401
    assert login(account["username"], "a-brand-new-password").status_code == 200


def test_deleting_an_account_revokes_access(admin_headers, barber_login) -> None:
    _, account, headers = barber_login

    response = client.delete(f"/api/v1/accounts/{account['id']}", headers=admin_headers)

    assert response.status_code == 204, response.text
    assert client.get("/api/v1/appointments", headers=headers).status_code == 401
    assert account["id"] not in [a["id"] for a in client.get("/api/v1/accounts", headers=admin_headers).json()]


def test_owner_account_cannot_be_deleted(admin_headers) -> None:
    owner = next(a for a in client.get("/api/v1/accounts", headers=admin_headers).json() if a["role"] == "owner")

    response = client.delete(f"/api/v1/accounts/{owner['id']}", headers=admin_headers)

    assert response.status_code == 400, response.text


@pytest.mark.parametrize(("method", "path"), [("get", "/api/v1/accounts"), ("get", "/api/v1/auth/me"), ("delete", "/api/v1/accounts/1")])
def test_account_endpoints_need_a_login(method, path) -> None:
    response = getattr(client, method)(path)
    assert response.status_code == 401, response.text
