from core.workflow.human_input_policy import (
    HumanInputSurface,
    get_preferred_form_token,
    is_recipient_type_allowed_for_surface,
)
from models.human_input import RecipientType


def test_service_api_only_allows_public_webapp_forms() -> None:
    assert is_recipient_type_allowed_for_surface(
        RecipientType.STANDALONE_WEB_APP,
        HumanInputSurface.SERVICE_API,
    )
    assert not is_recipient_type_allowed_for_surface(
        RecipientType.CONSOLE,
        HumanInputSurface.SERVICE_API,
    )
    assert not is_recipient_type_allowed_for_surface(
        RecipientType.BACKSTAGE,
        HumanInputSurface.SERVICE_API,
    )
    assert not is_recipient_type_allowed_for_surface(
        RecipientType.EMAIL_MEMBER,
        HumanInputSurface.SERVICE_API,
    )


def test_console_only_allows_internal_console_surfaces() -> None:
    assert is_recipient_type_allowed_for_surface(
        RecipientType.CONSOLE,
        HumanInputSurface.CONSOLE,
    )
    assert is_recipient_type_allowed_for_surface(
        RecipientType.BACKSTAGE,
        HumanInputSurface.CONSOLE,
    )
    assert not is_recipient_type_allowed_for_surface(
        RecipientType.STANDALONE_WEB_APP,
        HumanInputSurface.CONSOLE,
    )


def test_preferred_form_token_uses_shared_priority_order() -> None:
    recipients = [
        (RecipientType.STANDALONE_WEB_APP, "web-token"),
        (RecipientType.CONSOLE, "console-token"),
        (RecipientType.BACKSTAGE, "backstage-token"),
    ]

    assert get_preferred_form_token(recipients) == "backstage-token"
