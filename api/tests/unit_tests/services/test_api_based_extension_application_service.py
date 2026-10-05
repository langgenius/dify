from datetime import datetime
from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.api_based_extension_application_service import (
    APIBasedExtensionApplicationService,
    APIBasedExtensionConnectionError,
    APIBasedExtensionInput,
    APIBasedExtensionInvalidError,
    APIBasedExtensionNameConflictError,
    APIBasedExtensionNotFoundError,
    APIBasedExtensionRecord,
    APIBasedExtensionUpdate,
)


def _record(extension_id: str = "ext-1", *, api_key: str = "enc:secret") -> APIBasedExtensionRecord:
    return APIBasedExtensionRecord(
        id=extension_id,
        name="Docs",
        api_endpoint="https://docs.example.com",
        api_key=api_key,
        created_at=datetime(2024, 1, 1, 12, 0),
    )


class _FakeCipher:
    """Reversible stand-in cipher that records which workspace each call was scoped to."""

    def __init__(self) -> None:
        self.workspaces: list[str] = []

    def encrypt(self, workspace_id: str, value: str) -> str:
        self.workspaces.append(workspace_id)
        return f"enc:{value}"

    def decrypt(self, workspace_id: str, value: str) -> str:
        self.workspaces.append(workspace_id)
        assert value.startswith("enc:"), value
        return value.removeprefix("enc:")


@pytest.fixture
def context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


@pytest.fixture
def store() -> MagicMock:
    store = MagicMock()
    store.name_exists.return_value = False
    return store


@pytest.fixture
def probe() -> MagicMock:
    return MagicMock()


@pytest.fixture
def cipher() -> _FakeCipher:
    return _FakeCipher()


@pytest.fixture
def service(store: MagicMock, probe: MagicMock, cipher: _FakeCipher) -> APIBasedExtensionApplicationService:
    return APIBasedExtensionApplicationService(extensions=store, secrets=cipher, probe=probe)


def test_list_extensions_decrypts_stored_keys(
    service: APIBasedExtensionApplicationService, store: MagicMock, cipher: _FakeCipher, context: RequestContext
) -> None:
    store.list_extensions.return_value = [_record("ext-1", api_key="enc:one"), _record("ext-2", api_key="enc:two")]

    records = service.list_extensions(context)

    store.list_extensions.assert_called_once_with("workspace-1")
    assert [record.api_key for record in records] == ["one", "two"]
    assert cipher.workspaces == ["workspace-1", "workspace-1"]


def test_get_extension_decrypts_or_raises(
    service: APIBasedExtensionApplicationService, store: MagicMock, context: RequestContext
) -> None:
    store.find_extension.return_value = _record(api_key="enc:secret")

    assert service.get_extension(context, "ext-1").api_key == "secret"
    store.find_extension.assert_called_once_with("workspace-1", "ext-1")

    store.find_extension.return_value = None
    with pytest.raises(APIBasedExtensionNotFoundError):
        service.get_extension(context, "missing")


def test_create_extension_validates_pings_and_stores_ciphertext(
    service: APIBasedExtensionApplicationService, store: MagicMock, probe: MagicMock, context: RequestContext
) -> None:
    store.create_extension.return_value = _record(api_key="enc:plain-secret")
    extension = APIBasedExtensionInput(name="Docs", api_endpoint="https://docs.example.com", api_key="plain-secret")

    created = service.create_extension(context, extension)

    store.name_exists.assert_called_once_with("workspace-1", "Docs", exclude_id=None)
    probe.ping.assert_called_once_with("https://docs.example.com", "plain-secret")
    store.create_extension.assert_called_once_with("workspace-1", extension._replace(api_key="enc:plain-secret"))
    assert created.api_key == "plain-secret"


@pytest.mark.parametrize(
    ("extension", "message"),
    [
        (APIBasedExtensionInput(name="", api_endpoint="https://x.example.com", api_key="secret"), "name must not"),
        (APIBasedExtensionInput(name="Docs", api_endpoint="", api_key="secret"), "api_endpoint must not"),
        (APIBasedExtensionInput(name="Docs", api_endpoint="https://x.example.com", api_key=""), "api_key must not"),
        (APIBasedExtensionInput(name="Docs", api_endpoint="https://x.example.com", api_key="abcd"), "at least 5"),
    ],
)
def test_create_extension_rejects_invalid_fields_before_pinging(
    service: APIBasedExtensionApplicationService,
    store: MagicMock,
    probe: MagicMock,
    context: RequestContext,
    extension: APIBasedExtensionInput,
    message: str,
) -> None:
    with pytest.raises(APIBasedExtensionInvalidError, match=message):
        service.create_extension(context, extension)

    probe.ping.assert_not_called()
    store.create_extension.assert_not_called()


@pytest.mark.parametrize("api_key", ["abcde", "12345", "a-b-c"])
def test_create_extension_accepts_a_five_character_key(
    service: APIBasedExtensionApplicationService,
    store: MagicMock,
    probe: MagicMock,
    context: RequestContext,
    api_key: str,
) -> None:
    store.create_extension.return_value = _record(api_key=f"enc:{api_key}")
    extension = APIBasedExtensionInput(name="Docs", api_endpoint="https://docs.example.com", api_key=api_key)

    created = service.create_extension(context, extension)

    probe.ping.assert_called_once_with("https://docs.example.com", api_key)
    store.create_extension.assert_called_once_with("workspace-1", extension._replace(api_key=f"enc:{api_key}"))
    assert created.api_key == api_key


def test_update_extension_accepts_a_five_character_key(
    service: APIBasedExtensionApplicationService, store: MagicMock, probe: MagicMock, context: RequestContext
) -> None:
    store.find_extension.return_value = _record(api_key="enc:old-secret")
    store.update_extension.return_value = _record(api_key="enc:abcde")

    updated = service.update_extension(
        context, "ext-1", APIBasedExtensionUpdate(name="Docs", api_endpoint="https://docs.example.com", api_key="abcde")
    )

    probe.ping.assert_called_once_with("https://docs.example.com", "abcde")
    assert store.update_extension.call_args.args[2].api_key == "enc:abcde"
    assert updated.api_key == "abcde"


def test_create_extension_rejects_duplicate_names_and_unreachable_endpoints(
    service: APIBasedExtensionApplicationService, store: MagicMock, probe: MagicMock, context: RequestContext
) -> None:
    extension = APIBasedExtensionInput(name="Docs", api_endpoint="https://docs.example.com", api_key="secret")

    store.name_exists.return_value = True
    with pytest.raises(APIBasedExtensionNameConflictError):
        service.create_extension(context, extension)

    store.name_exists.return_value = False
    probe.ping.side_effect = APIBasedExtensionConnectionError("request timeout")
    with pytest.raises(APIBasedExtensionConnectionError, match="connection error: request timeout"):
        service.create_extension(context, extension)

    store.create_extension.assert_not_called()


def test_update_extension_keeps_the_stored_key_when_none_is_given(
    service: APIBasedExtensionApplicationService, store: MagicMock, probe: MagicMock, context: RequestContext
) -> None:
    store.find_extension.return_value = _record(api_key="enc:keep-me")
    store.update_extension.return_value = _record(api_key="enc:keep-me")

    updated = service.update_extension(
        context,
        "ext-1",
        APIBasedExtensionUpdate(name="Docs v2", api_endpoint="https://docs.example.com/v2", api_key=None),
    )

    store.name_exists.assert_called_once_with("workspace-1", "Docs v2", exclude_id="ext-1")
    probe.ping.assert_called_once_with("https://docs.example.com/v2", "keep-me")
    store.update_extension.assert_called_once_with(
        "workspace-1",
        "ext-1",
        APIBasedExtensionInput(name="Docs v2", api_endpoint="https://docs.example.com/v2", api_key="enc:keep-me"),
    )
    assert updated.api_key == "keep-me"


def test_update_extension_encrypts_a_new_key(
    service: APIBasedExtensionApplicationService, store: MagicMock, context: RequestContext
) -> None:
    store.find_extension.return_value = _record(api_key="enc:old")
    store.update_extension.return_value = _record(api_key="enc:new-secret")

    updated = service.update_extension(
        context,
        "ext-1",
        APIBasedExtensionUpdate(name="Docs", api_endpoint="https://docs.example.com", api_key="new-secret"),
    )

    assert store.update_extension.call_args.args[2].api_key == "enc:new-secret"
    assert updated.api_key == "new-secret"


def test_update_requires_an_existing_extension(
    service: APIBasedExtensionApplicationService, store: MagicMock, context: RequestContext
) -> None:
    store.find_extension.return_value = None

    with pytest.raises(APIBasedExtensionNotFoundError):
        service.update_extension(
            context, "missing", APIBasedExtensionUpdate(name="x", api_endpoint="https://x.example.com", api_key="y")
        )

    store.update_extension.assert_not_called()


def test_delete_extension_delegates_existence_to_the_store(
    service: APIBasedExtensionApplicationService, store: MagicMock, context: RequestContext
) -> None:
    service.delete_extension(context, "ext-1")

    store.delete_extension.assert_called_once_with("workspace-1", "ext-1")
    store.find_extension.assert_not_called()

    store.delete_extension.side_effect = APIBasedExtensionNotFoundError()
    with pytest.raises(APIBasedExtensionNotFoundError):
        service.delete_extension(context, "missing")
