"""Trigger credential verification payload contracts."""

import pytest
from pydantic import ValidationError

from controllers.console.workspace.trigger_providers import (
    TriggerSubscriptionBuilderVerifyPayload,
    TriggerSubscriptionVerifyPayload,
)


def test_builder_verify_payload_allows_credentials_to_be_omitted() -> None:
    payload = TriggerSubscriptionBuilderVerifyPayload.model_validate({})

    assert payload.credentials is None


def test_subscription_verify_payload_requires_credentials() -> None:
    with pytest.raises(ValidationError):
        TriggerSubscriptionVerifyPayload.model_validate({})
