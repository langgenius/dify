from types import SimpleNamespace

import pytest

from core.workflow.human_input_forms import (
    load_form_dispositions_by_form_id,
    load_form_tokens_by_form_id,
)
from core.workflow.human_input_policy import (
    FormDisposition,
    HumanInputSurface,
    disposition_for_surface,
)
from models.human_input import RecipientType


class _FakeSession:
    def __init__(self, recipients: list[SimpleNamespace]) -> None:
        self._recipients = recipients

    def scalars(self, _stmt):
        return self._recipients


def _recipient(form_id: str, recipient_type: RecipientType, access_token: str | None) -> SimpleNamespace:
    return SimpleNamespace(form_id=form_id, recipient_type=recipient_type, access_token=access_token)


@pytest.mark.parametrize(
    ("surface", "expected_token"),
    [
        # Unfiltered (no surface) picks the highest-priority recipient: backstage.
        (None, "backstage-token"),
        # SERVICE_API may only act on the web-app recipient.
        (HumanInputSurface.SERVICE_API, "web-token"),
    ],
)
def test_load_form_tokens_picks_token_for_surface(surface, expected_token) -> None:
    session = _FakeSession(
        [
            _recipient("form-1", RecipientType.STANDALONE_WEB_APP, "web-token"),
            _recipient("form-1", RecipientType.CONSOLE, "console-token"),
            _recipient("form-1", RecipientType.BACKSTAGE, "backstage-token"),
        ]
    )

    assert load_form_tokens_by_form_id(["form-1"], session=session, surface=surface) == {"form-1": expected_token}


def test_load_form_tokens_drops_forms_without_actionable_token() -> None:
    session = _FakeSession(
        [
            _recipient("form-1", RecipientType.EMAIL_MEMBER, "email-token"),
            _recipient("form-1", RecipientType.CONSOLE, None),
        ]
    )

    assert load_form_tokens_by_form_id(["form-1"], session=session) == {}


def test_load_form_tokens_service_api_surface_uses_web_token() -> None:
    session = _FakeSession(
        [
            _recipient("form-1", RecipientType.STANDALONE_WEB_APP, "web-token"),
            _recipient("form-1", RecipientType.CONSOLE, "console-token"),
            _recipient("form-1", RecipientType.BACKSTAGE, "backstage-token"),
        ]
    )

    assert load_form_tokens_by_form_id(["form-1"], session=session, surface=HumanInputSurface.SERVICE_API) == {
        "form-1": "web-token"
    }


def test_load_dispositions_openapi_webapp_form_is_resumable() -> None:
    session = _FakeSession(
        [
            _recipient("form-1", RecipientType.STANDALONE_WEB_APP, "web-token"),
            _recipient("form-1", RecipientType.BACKSTAGE, "backstage-token"),
        ]
    )

    assert load_form_dispositions_by_form_id(["form-1"], session=session, surface=HumanInputSurface.OPENAPI) == {
        "form-1": FormDisposition(form_token="web-token", approval_channels=["console"])
    }


def test_load_dispositions_openapi_backstage_only_form_yields_channels_not_token() -> None:
    session = _FakeSession([_recipient("form-1", RecipientType.BACKSTAGE, "backstage-token")])

    assert load_form_dispositions_by_form_id(["form-1"], session=session, surface=HumanInputSurface.OPENAPI) == {
        "form-1": FormDisposition(form_token=None, approval_channels=["console"])
    }


# disposition_for_surface partitions recipients into a surface-actionable resume
# token plus the approval channels of the recipients the surface may NOT act on.
_WEB = (RecipientType.STANDALONE_WEB_APP, "tok_web")
_BACKSTAGE = (RecipientType.BACKSTAGE, "tok_b")
_CONSOLE = (RecipientType.CONSOLE, "tok_c")
_EMAIL_MEMBER = (RecipientType.EMAIL_MEMBER, "t1")
_EMAIL_EXTERNAL = (RecipientType.EMAIL_EXTERNAL, "t2")


@pytest.mark.parametrize(
    ("recipients", "surface", "expected"),
    [
        # Token surface acts on the web-app recipient; blocked recipients become channels.
        ([_BACKSTAGE, _WEB], HumanInputSurface.OPENAPI, FormDisposition("tok_web", ["console"])),
        ([_EMAIL_MEMBER, _EMAIL_EXTERNAL], HumanInputSurface.OPENAPI, FormDisposition(None, ["email"])),
        ([_EMAIL_MEMBER, _BACKSTAGE], HumanInputSurface.OPENAPI, FormDisposition(None, ["console", "email"])),
        # CONSOLE acts on console/backstage; a web-app recipient is blocked → web_app channel.
        ([_CONSOLE, _WEB], HumanInputSurface.CONSOLE, FormDisposition("tok_c", ["web_app"])),
        ([_WEB], HumanInputSurface.CONSOLE, FormDisposition(None, ["web_app"])),
        # No surface: unfiltered priority token, channels never populated.
        ([_BACKSTAGE], None, FormDisposition("tok_b", [])),
        ([_WEB, _EMAIL_MEMBER], None, FormDisposition("tok_web", [])),
    ],
)
def test_disposition_for_surface_partitions_token_and_channels(recipients, surface, expected) -> None:
    assert disposition_for_surface(recipients, surface=surface) == expected
