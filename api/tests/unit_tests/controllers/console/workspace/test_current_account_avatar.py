from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_ACCESS_TOKEN
from controllers.console import bp as console_bp
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions.ext_login import bind_account_loader, bind_account_only_loader, login_manager
from libs.datetime_utils import naive_utc_now
from libs.passport import PassportService
from libs.token import _real_cookie_name
from models.account import Account
from models.model import UploadFile
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
from services.upload_file_delivery_service import UploadFileDeliveryService
from tests.helpers.unit.model_factories import make_account, make_upload_file

_VIEWER_ID = "11111111-1111-1111-1111-111111111111"
_OWNER_ID = "22222222-2222-2222-2222-222222222222"
_UNRELATED_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
_FILE_ID = "44444444-4444-4444-4444-444444444444"
_NEXT_FILE_ID = "55555555-5555-5555-5555-555555555555"
_FILE_KEY = "uploads/current-avatar.png"
_NEXT_FILE_KEY = "uploads/next-avatar.png"
_IMAGE = b"current avatar image"
_NEXT_IMAGE = b"next avatar image"


@dataclass
class _StorageSpy:
    payloads: dict[str, bytes] = field(default_factory=lambda: {_FILE_KEY: _IMAGE})
    reads: list[str] = field(default_factory=list)

    def load_stream(self, filename: str) -> Iterator[bytes]:
        self.reads.append(filename)
        return iter((self.payloads[filename],))

    def load_once(self, filename: str) -> bytes:
        raise AssertionError(f"avatar delivery must stream {filename}")


@dataclass(frozen=True)
class _ApplicationServices:
    upload_file_delivery: UploadFileDeliveryService


@dataclass(frozen=True)
class _Harness:
    app: DifyApp
    client: FlaskClient
    storage: _StorageSpy
    session_factory: sessionmaker[Session]

    @staticmethod
    def url(*, account_id: str = _OWNER_ID, file_id: str = _FILE_ID) -> str:
        return f"/console/api/accounts/{account_id}/avatars/{file_id}"


@pytest.fixture
def harness(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> _Harness:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=False,
        SECRET_KEY="test-only-avatar-controller-signing-key",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    viewer = make_account(account_id=_VIEWER_ID, email="viewer@example.com", tenant=None)
    owner = make_account(account_id=_OWNER_ID, email="owner@example.com", tenant=None)
    owner.avatar = _FILE_ID
    upload = make_upload_file(
        file_id=_FILE_ID,
        created_by=_OWNER_ID,
        name="avatar.png",
        extension="png",
        mime_type="image/png",
        key=_FILE_KEY,
        size=len(_IMAGE),
    )
    with sqlite_session_factory.begin() as session:
        session.add_all((viewer, owner, upload))

    storage = _StorageSpy()
    delivery = UploadFileDeliveryService(
        files=UploadFileDeliveryQueryRepository(session_factory=sqlite_session_factory),
        storage=storage,
    )
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    app.extensions["application_services"] = _ApplicationServices(delivery)

    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)

    def load_workspace_account(account_id: str) -> Account | None:
        return accounts.load_identity(account_id, now=naive_utc_now())

    login_manager.init_app(app)
    bind_account_loader(app, load_workspace_account)
    bind_account_only_loader(app, accounts.get_model)
    app.register_blueprint(console_bp)
    client = app.test_client()
    client.set_cookie(
        _real_cookie_name(COOKIE_NAME_ACCESS_TOKEN),
        PassportService().issue({"user_id": _VIEWER_ID}),
    )
    return _Harness(app=app, client=client, storage=storage, session_factory=sqlite_session_factory)


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_avatar_reads_allow_a_workspace_less_account_without_csrf(harness: _Harness, method: str) -> None:
    # The viewer has no workspace membership and sends only the HttpOnly session cookie.
    response = harness.client.open(harness.url(), method=method)

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert response.headers["ETag"] == f'"{_FILE_ID}"'
    assert response.headers["Content-Length"] == str(len(_IMAGE))
    assert response.headers["Cache-Control"] == "private, max-age=300, must-revalidate"
    if method == "GET":
        assert response.get_data() == _IMAGE
        assert harness.storage.reads == [_FILE_KEY]
    else:
        assert response.get_data() == b""
        assert not harness.storage.reads


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_avatar_reads_require_an_authenticated_console_account(harness: _Harness, method: str) -> None:
    response = harness.app.test_client().open(harness.url(), method=method)

    assert response.status_code == 401
    assert not harness.storage.reads


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_matching_etag_returns_304_after_auth_without_reading_storage(harness: _Harness, method: str) -> None:
    initial = harness.client.get(harness.url())
    assert initial.get_data() == _IMAGE
    etag = initial.headers["ETag"]
    harness.storage.reads.clear()

    response = harness.client.open(harness.url(), method=method, headers={"If-None-Match": etag})

    assert response.status_code == 304
    assert response.headers["ETag"] == etag
    assert response.headers["Cache-Control"] == "private, max-age=300, must-revalidate"
    assert response.get_data() == b""
    assert not harness.storage.reads

    anonymous = harness.app.test_client().open(harness.url(), method=method, headers={"If-None-Match": etag})
    assert anonymous.status_code == 401
    assert not harness.storage.reads


@pytest.mark.parametrize(
    "case",
    ["unrelated-account", "unassigned", "other-owner", "invalid-raster"],
)
def test_ineligible_avatar_references_are_rejected_before_storage(harness: _Harness, case: str) -> None:
    account_id = _OWNER_ID
    with harness.session_factory.begin() as session:
        owner = session.get_one(Account, _OWNER_ID)
        upload = session.get_one(UploadFile, _FILE_ID)
        if case == "unrelated-account":
            account_id = _UNRELATED_ACCOUNT_ID
        elif case == "unassigned":
            owner.avatar = None
        elif case == "other-owner":
            upload.created_by = _VIEWER_ID
        elif case == "invalid-raster":
            upload.name = "avatar.svg"
            upload.extension = "svg"
            upload.mime_type = "image/svg+xml"
        else:
            raise AssertionError(f"unexpected case: {case}")

    response = harness.client.get(harness.url(account_id=account_id))

    assert response.status_code == 404
    assert response.get_json()["message"] == "Avatar file not found"
    assert response.headers["Cache-Control"] == "private, no-store"
    assert not harness.storage.reads


def test_changing_avatar_invalidates_the_old_url_even_with_its_etag(harness: _Harness) -> None:
    initial = harness.client.get(harness.url())
    assert initial.get_data() == _IMAGE
    old_etag = initial.headers["ETag"]
    harness.storage.reads.clear()

    next_upload = make_upload_file(
        file_id=_NEXT_FILE_ID,
        created_by=_OWNER_ID,
        name="next.png",
        extension="png",
        mime_type="image/png",
        key=_NEXT_FILE_KEY,
        size=len(_NEXT_IMAGE),
    )
    with harness.session_factory.begin() as session:
        session.add(next_upload)
        session.get_one(Account, _OWNER_ID).avatar = _NEXT_FILE_ID
    harness.storage.payloads[_NEXT_FILE_KEY] = _NEXT_IMAGE

    stale = harness.client.get(harness.url(), headers={"If-None-Match": old_etag})

    assert stale.status_code == 404
    assert stale.headers["Cache-Control"] == "private, no-store"
    assert not harness.storage.reads

    current = harness.client.get(harness.url(file_id=_NEXT_FILE_ID))
    assert current.get_data() == _NEXT_IMAGE
    assert harness.storage.reads == [_NEXT_FILE_KEY]
