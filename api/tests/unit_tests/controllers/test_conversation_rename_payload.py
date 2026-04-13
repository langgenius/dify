import pytest
from pydantic import ValidationError

from controllers.console.explore.conversation import ConversationRenamePayload as ConsolePayload
from controllers.service_api.app.conversation import ConversationRenamePayload as ServicePayload


@pytest.mark.parametrize("payload_cls", [ConsolePayload, ServicePayload])
def test_payload_allows_auto_generate_without_name(payload_cls):
    payload = payload_cls.model_validate({"auto_generate": True})

    assert payload.auto_generate is True
    assert payload.name is None


@pytest.mark.parametrize("payload_cls", [ConsolePayload, ServicePayload])
@pytest.mark.parametrize("value", [None, "", "   "])
def test_payload_requires_name_when_not_auto_generate(payload_cls, value):
    with pytest.raises(ValidationError):
        payload_cls.model_validate({"name": value, "auto_generate": False})
