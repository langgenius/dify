"""Tests for OPENAPI surface in HumanInputPolicy and human_input_forms."""

from __future__ import annotations

from core.workflow.human_input_policy import HumanInputSurface, is_recipient_type_allowed_for_surface
from models.human_input import RecipientType


def test_openapi_surface_exists():
    assert HumanInputSurface.OPENAPI == "openapi"


def test_openapi_allows_standalone_web_app():
    assert is_recipient_type_allowed_for_surface(RecipientType.STANDALONE_WEB_APP, HumanInputSurface.OPENAPI)


def test_openapi_rejects_console_recipient():
    assert not is_recipient_type_allowed_for_surface(RecipientType.CONSOLE, HumanInputSurface.OPENAPI)


def test_openapi_rejects_backstage_recipient():
    assert not is_recipient_type_allowed_for_surface(RecipientType.BACKSTAGE, HumanInputSurface.OPENAPI)


def test_get_surface_form_token_openapi_picks_standalone_web_app():
    """OPENAPI surface should pick STANDALONE_WEB_APP token, same as SERVICE_API."""
    from core.workflow.human_input_forms import _get_surface_form_token

    recipients = [
        (RecipientType.BACKSTAGE, "backstage-token"),
        (RecipientType.STANDALONE_WEB_APP, "web-token"),
    ]
    token = _get_surface_form_token(recipients, surface=HumanInputSurface.OPENAPI)
    assert token == "web-token"
