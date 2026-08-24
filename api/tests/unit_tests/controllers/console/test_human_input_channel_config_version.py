import importlib
import importlib.util

import pytest

from core.human_input_v2.email_channel import EmailConfigurationSnapshot
from core.human_input_v2.im_integration import IntegrationRevisionToken
from core.human_input_v2.shared import EmailProviderId, IntegrationId


def _config_version_module():
    module_name = "controllers.console.human_input_v2.config_version"
    assert importlib.util.find_spec(module_name) is not None, "the Console config-version codec is missing"
    return importlib.import_module(module_name)


def test_email_config_version_round_trips_the_owner_native_snapshot() -> None:
    module = _config_version_module()
    snapshot = EmailConfigurationSnapshot(EmailProviderId("email-1"), 3)

    encoded = module.encode_email_config_version(snapshot)

    assert module.decode_email_config_version(encoded, snapshot.configuration_id) == snapshot


def test_im_config_version_round_trips_the_complete_owner_native_revision() -> None:
    module = _config_version_module()
    revision = IntegrationRevisionToken(IntegrationId("integration-1"), 5)

    encoded = module.encode_im_config_version(revision)

    assert module.decode_im_config_version(encoded, revision.integration_id) == revision


@pytest.mark.parametrize(
    "encoded",
    [
        "not-base64",
        "",
    ],
)
def test_config_version_rejects_malformed_values(encoded: str) -> None:
    module = _config_version_module()
    with pytest.raises(module.InvalidConfigVersionError):
        module.decode_im_config_version(encoded, IntegrationId("integration-1"))


def test_config_version_rejects_another_kind_or_resource_identity() -> None:
    module = _config_version_module()
    email_snapshot = EmailConfigurationSnapshot(EmailProviderId("email-1"), 1)
    encoded = module.encode_email_config_version(email_snapshot)

    with pytest.raises(module.InvalidConfigVersionError):
        module.decode_email_config_version(encoded, EmailProviderId("email-2"))
    with pytest.raises(module.InvalidConfigVersionError):
        module.decode_im_config_version(encoded, IntegrationId("email-1"))
