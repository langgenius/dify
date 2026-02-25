from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture

from core.helper.credential_utils import check_credential_policy_compliance
from services.enterprise.plugin_manager_service import PluginCredentialType


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

    with pytest.raises(ValueError, match="Credential with id cred-1"):
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
