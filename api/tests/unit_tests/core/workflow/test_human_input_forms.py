from types import SimpleNamespace

from core.workflow.human_input_forms import _load_form_tokens_by_form_id, load_form_tokens_by_form_id
from core.workflow.human_input_policy import HumanInputSurface
from models.human_input import RecipientType


class _FakeSession:
    def __init__(self, recipients: list[SimpleNamespace]) -> None:
        self._recipients = recipients

    def scalars(self, _stmt):
        return self._recipients


def test_load_form_tokens_by_form_id_prefers_backstage_token() -> None:
    session = _FakeSession(
        recipients=[
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                access_token="web-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.CONSOLE,
                access_token="console-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.BACKSTAGE,
                access_token="backstage-token",
            ),
        ]
    )

    assert load_form_tokens_by_form_id(["form-1"], session=session) == {"form-1": "backstage-token"}


def test_load_form_tokens_by_form_id_ignores_unsupported_recipients() -> None:
    session = _FakeSession(
        recipients=[
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.EMAIL_MEMBER,
                access_token="email-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.CONSOLE,
                access_token=None,
            ),
        ]
    )

    assert load_form_tokens_by_form_id(["form-1"], session=session) == {}


def test_load_form_tokens_by_form_id_uses_shared_priority() -> None:
    session = _FakeSession(
        recipients=[
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                access_token="web-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.CONSOLE,
                access_token="console-token",
            ),
        ]
    )

    assert _load_form_tokens_by_form_id(session, ["form-1"]) == {"form-1": "console-token"}


def test_load_form_tokens_by_form_id_uses_web_token_for_service_api_surface() -> None:
    session = _FakeSession(
        recipients=[
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                access_token="web-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.CONSOLE,
                access_token="console-token",
            ),
            SimpleNamespace(
                form_id="form-1",
                recipient_type=RecipientType.BACKSTAGE,
                access_token="backstage-token",
            ),
        ]
    )

    assert load_form_tokens_by_form_id(
        ["form-1"],
        session=session,
        surface=HumanInputSurface.SERVICE_API,
    ) == {"form-1": "web-token"}
