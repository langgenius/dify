from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.console.human_input_v2.providers import WeComCredentialsInput as WeComCredentialUpdate
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import adapters as im_adapters


def test_wecom_credential_projections_are_field_aligned() -> None:
    resolved_credentials = im_adapters.WeComCredentials

    assert set(WeComCredentialUpdate.model_fields) == {"provider", "corp_id", "agent_id", "secret"}
    assert set(resolved_credentials.model_fields) == {"provider", "corp_id", "agent_id", "secret"}


def test_wecom_credentials_are_strict_immutable_and_secret_safe() -> None:
    resolved_credentials = im_adapters.WeComCredentials
    credentials = resolved_credentials(
        provider=IMProvider.WE_COM,
        corp_id="fake-corp-001",
        agent_id="1000001",
        secret="fake-secret-001",
    )
    update = WeComCredentialUpdate(
        provider=IMProvider.WE_COM,
        corp_id="fake-corp-001",
        agent_id="1000001",
        secret="fake-secret-001",
    )
    assert credentials.model_config["frozen"] is True
    assert credentials.model_config["extra"] == "forbid"
    assert credentials.model_config["strict"] is True
    assert "fake-secret-001" not in repr(credentials)
    assert "fake-secret-001" not in repr(update)

    with pytest.raises(ValidationError):
        resolved_credentials.model_validate({**credentials.model_dump(), "unexpected": "fake-value"})
    with pytest.raises(ValidationError):
        credentials.agent_id = "1000002"
    with pytest.raises(ValidationError):
        resolved_credentials.model_validate({**credentials.model_dump(), "agent_id": 1000001})


@pytest.mark.parametrize("field_name", ["corp_id", "agent_id", "secret"])
def test_wecom_resolved_credentials_reject_blank_fields(field_name: str) -> None:
    resolved_credentials = im_adapters.WeComCredentials
    values = {
        "provider": IMProvider.WE_COM,
        "corp_id": "fake-corp-001",
        "agent_id": "1000001",
        "secret": "fake-secret-001",
    }
    values[field_name] = "   "

    with pytest.raises(ValidationError):
        resolved_credentials.model_validate(values)


def test_wecom_resolved_credentials_require_a_positive_decimal_agent_id() -> None:
    resolved_credentials = im_adapters.WeComCredentials

    with pytest.raises(ValidationError):
        resolved_credentials(
            provider=IMProvider.WE_COM,
            corp_id="fake-corp-001",
            agent_id="not-a-decimal-agent-id",
            secret="fake-secret-001",
        )


def test_preserve_original_value_never_enters_wecom_resolved_credentials() -> None:
    resolved_credentials = im_adapters.WeComCredentials

    with pytest.raises(ValidationError):
        WeComCredentialUpdate.model_validate(
            {
                "provider": IMProvider.WE_COM,
                "corp_id": "fake-corp-001",
                "agent_id": "1000001",
                "secret": {"tag": "preserve_original_value"},
            }
        )
    with pytest.raises(ValidationError):
        resolved_credentials.model_validate(
            {
                "provider": IMProvider.WE_COM,
                "corp_id": "fake-corp-001",
                "agent_id": "1000001",
                "secret": {"tag": "preserve_original_value"},
            }
        )
