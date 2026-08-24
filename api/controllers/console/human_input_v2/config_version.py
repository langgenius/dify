"""Transport-only encoding for owner-native Channel revision tokens."""

from __future__ import annotations

import base64
import json

from core.human_input_v2.channel_identity import ChannelKind
from core.human_input_v2.email_channel import EmailConfigurationSnapshot
from core.human_input_v2.im_integration import IntegrationRevisionToken
from core.human_input_v2.shared import EmailProviderId, IntegrationId

_FORMAT_VERSION = 1


class InvalidConfigVersionError(ValueError):
    """The opaque transport value does not name the addressed owner revision."""


def encode_email_config_version(snapshot: EmailConfigurationSnapshot) -> str:
    return _encode(ChannelKind.EMAIL, snapshot.configuration_id, snapshot.config_version)


def decode_email_config_version(
    value: str,
    channel_id: EmailProviderId,
) -> EmailConfigurationSnapshot:
    revision = _decode(value, ChannelKind.EMAIL, channel_id)
    return EmailConfigurationSnapshot(channel_id, revision)


def encode_im_config_version(revision: IntegrationRevisionToken) -> str:
    return _encode(ChannelKind.IM, revision.integration_id, revision.config_version)


def decode_im_config_version(
    value: str,
    channel_id: IntegrationId,
) -> IntegrationRevisionToken:
    config_version = _decode(value, ChannelKind.IM, channel_id)
    return IntegrationRevisionToken(channel_id, config_version)


def _encode(
    kind: ChannelKind,
    channel_id: EmailProviderId | IntegrationId,
    config_version: int,
) -> str:
    serialized = json.dumps(
        (_FORMAT_VERSION, kind.value, str(channel_id), config_version),
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(serialized).rstrip(b"=").decode("ascii")


def _decode(
    value: str,
    expected_kind: ChannelKind,
    expected_channel_id: EmailProviderId | IntegrationId,
) -> int:
    try:
        padding = "=" * (-len(value) % 4)
        serialized = base64.b64decode(value + padding, altchars=b"-_", validate=True)
        decoded = json.loads(serialized)
    except (UnicodeEncodeError, ValueError, json.JSONDecodeError):
        raise InvalidConfigVersionError("invalid configuration version") from None

    if not isinstance(decoded, list) or len(decoded) != 4:
        raise InvalidConfigVersionError("invalid configuration version")
    format_version, kind, channel_id, config_version = decoded
    if (
        format_version != _FORMAT_VERSION
        or kind != expected_kind.value
        or channel_id != str(expected_channel_id)
        or isinstance(config_version, bool)
        or not isinstance(config_version, int)
        or config_version < 1
    ):
        raise InvalidConfigVersionError("invalid configuration version")
    return config_version


__all__ = [
    "InvalidConfigVersionError",
    "decode_email_config_version",
    "decode_im_config_version",
    "encode_email_config_version",
    "encode_im_config_version",
]
