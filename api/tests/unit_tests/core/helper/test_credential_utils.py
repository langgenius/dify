from types import SimpleNamespace
from typing import cast

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.entities import PluginCredentialType
from core.helper.credential_utils import check_credential_policy_compliance, is_credential_exists
from models.provider import ProviderCredential, ProviderModelCredential
from models.tools import BuiltinToolProvider

SQLITE_MODELS = (ProviderCredential, ProviderModelCredential, BuiltinToolProvider)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@pytest.fixture(autouse=True)
def bind_session_factory(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """Bind service-owned sessions to the current test's SQLite engine."""

    maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "create_session", maker)


def _persist_credential(session: Session, credential_type: PluginCredentialType) -> None:
    if credential_type == PluginCredentialType.MODEL:
        credential = ProviderCredential(
            tenant_id="tenant-1",
            provider_name="openai",
            credential_name="Default",
            encrypted_config="{}",
        )
    else:
        credential = BuiltinToolProvider(
            tenant_id="tenant-1",
            user_id="user-1",
            provider="openai",
            name="Default",
        )
    credential.id = "cred-1"
    session.add(credential)
    session.commit()


def test_check_credential_policy_compliance_returns_when_feature_disabled(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "services.feature_service.FeatureService.get_system_features",
        return_value=SimpleNamespace(plugin_manager=SimpleNamespace(enabled=False)),
    )
    check_call = mocker.patch(
        "services.enterprise.plugin_manager_service.PluginManagerService.check_credential_policy_compliance"
    )

    check_credential_policy_compliance("cred-1", "openai", PluginCredentialType.MODEL)

    check_call.assert_not_called()


def test_check_credential_policy_compliance_raises_when_credential_missing(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "services.feature_service.FeatureService.get_system_features",
        return_value=SimpleNamespace(plugin_manager=SimpleNamespace(enabled=True)),
    )
    mocker.patch("core.helper.credential_utils.is_credential_exists", return_value=False)

    with pytest.raises(ValueError, match="Credential with id cred-1 for provider openai not found."):
        check_credential_policy_compliance("cred-1", "openai", PluginCredentialType.TOOL)


def test_check_credential_policy_compliance_calls_plugin_manager_with_request(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "services.feature_service.FeatureService.get_system_features",
        return_value=SimpleNamespace(plugin_manager=SimpleNamespace(enabled=True)),
    )
    mocker.patch("core.helper.credential_utils.is_credential_exists", return_value=True)
    check_call = mocker.patch(
        "services.enterprise.plugin_manager_service.PluginManagerService.check_credential_policy_compliance"
    )

    check_credential_policy_compliance("cred-1", "openai", PluginCredentialType.MODEL)

    check_call.assert_called_once()
    request_arg = check_call.call_args.args[0]
    assert request_arg.dify_credential_id == "cred-1"
    assert request_arg.provider == "openai"
    assert request_arg.credential_type == PluginCredentialType.MODEL


def test_check_credential_policy_compliance_skips_existence_check_when_disabled(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "services.feature_service.FeatureService.get_system_features",
        return_value=SimpleNamespace(plugin_manager=SimpleNamespace(enabled=True)),
    )
    exists_call = mocker.patch("core.helper.credential_utils.is_credential_exists")
    check_call = mocker.patch(
        "services.enterprise.plugin_manager_service.PluginManagerService.check_credential_policy_compliance"
    )

    check_credential_policy_compliance(
        credential_id="cred-1",
        provider="openai",
        credential_type=PluginCredentialType.MODEL,
        check_existence=False,
    )

    exists_call.assert_not_called()
    check_call.assert_called_once()


def test_check_credential_policy_compliance_returns_when_credential_id_empty(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "services.feature_service.FeatureService.get_system_features",
        return_value=SimpleNamespace(plugin_manager=SimpleNamespace(enabled=True)),
    )
    exists_call = mocker.patch("core.helper.credential_utils.is_credential_exists")
    check_call = mocker.patch(
        "services.enterprise.plugin_manager_service.PluginManagerService.check_credential_policy_compliance"
    )

    check_credential_policy_compliance("", "openai", PluginCredentialType.MODEL)

    exists_call.assert_not_called()
    check_call.assert_not_called()


@pytest.mark.parametrize(
    ("credential_type", "scalar_result", "expected"),
    [
        (PluginCredentialType.MODEL, "model-credential", True),
        (PluginCredentialType.MODEL, None, False),
        (PluginCredentialType.TOOL, "tool-credential", True),
        (PluginCredentialType.TOOL, None, False),
    ],
)
def test_is_credential_exists_by_type(
    sqlite_session: Session,
    credential_type: PluginCredentialType,
    scalar_result: str | None,
    expected: bool,
) -> None:
    if scalar_result is not None:
        _persist_credential(sqlite_session, credential_type)

    result = is_credential_exists("cred-1", credential_type)

    assert result is expected


def test_is_credential_exists_returns_false_for_unknown_type() -> None:
    result = is_credential_exists("cred-1", cast(PluginCredentialType, "unknown"))

    assert result is False


def test_is_credential_exists_uses_configured_session_factory_without_flask_app_context(
    mocker: MockerFixture,
    sqlite_session: Session,
) -> None:
    class RaisingDB:
        @property
        def engine(self):
            raise RuntimeError("Working outside of application context.")

    _persist_credential(sqlite_session, PluginCredentialType.MODEL)
    mocker.patch("extensions.ext_database.db", new=RaisingDB())

    result = is_credential_exists("cred-1", PluginCredentialType.MODEL)

    assert result is True
