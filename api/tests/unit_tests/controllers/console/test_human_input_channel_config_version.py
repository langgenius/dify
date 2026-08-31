import importlib

import pytest

from core.human_input_v2.shared import EmailProviderId
from repositories.human_input_v2.email_channel import EmailConfigurationSnapshot
from repositories.human_input_v2.im_channel_repository import IMChannelId


def _config_version_module():
    return importlib.import_module("controllers.console.human_input_v2.config_version")


def test_email_config_version_round_trips_the_owner_native_snapshot() -> None:
    module = _config_version_module()
    snapshot = EmailConfigurationSnapshot(EmailProviderId("email-1"), 3)

    encoded = module.encode_email_config_version(snapshot)

    assert module.decode_email_config_version(encoded, snapshot.configuration_id) == snapshot


def test_im_config_version_round_trips_channel_id_and_numeric_version() -> None:
    module = _config_version_module()
    channel_id = IMChannelId("channel-1")

    encoded = module.encode_im_config_version(channel_id, 5)

    assert module.decode_im_config_version(encoded, channel_id) == 5


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
        module.decode_im_config_version(encoded, IMChannelId("channel-1"))


def test_config_version_rejects_another_kind_or_resource_identity() -> None:
    module = _config_version_module()
    email_snapshot = EmailConfigurationSnapshot(EmailProviderId("email-1"), 1)
    encoded = module.encode_email_config_version(email_snapshot)

    with pytest.raises(module.InvalidConfigVersionError):
        module.decode_email_config_version(encoded, EmailProviderId("email-2"))
    with pytest.raises(module.InvalidConfigVersionError):
        module.decode_im_config_version(encoded, IMChannelId("email-1"))
