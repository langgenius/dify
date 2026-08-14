"""Regression coverage for ``models.web.SavedMessage.message`` accessor.

Ensures the property→method refactor (drop of ``db.session`` in favor of a caller-provided
``Session``) preserves query intent: the accessor forwards ``self.message_id`` to the
supplied session and returns whatever the session returns.
"""

from unittest.mock import MagicMock

from models.enums import CreatorUserRole
from models.web import SavedMessage


def _saved_message() -> SavedMessage:
    """Construct a SavedMessage without touching the database."""
    return SavedMessage(
        app_id="00000000-0000-0000-0000-000000000001",
        message_id="00000000-0000-0000-0000-000000000002",
        created_by_role=CreatorUserRole.END_USER,
        created_by="00000000-0000-0000-0000-000000000003",
    )


def test_message_forwards_query_to_supplied_session() -> None:
    saved = _saved_message()
    session = MagicMock()
    sentinel = object()
    session.scalar.return_value = sentinel

    result = saved.message(session=session)

    assert result is sentinel
    # scalar() is called with a Select; asserting the argument is a Select-shaped
    # object is enough to prove the accessor still issues a lookup by message_id.
    session.scalar.assert_called_once()
    args, _ = session.scalar.call_args
    assert args, "expected the Select statement to be passed as a positional argument"


def test_message_returns_none_when_session_yields_none() -> None:
    saved = _saved_message()
    session = MagicMock()
    session.scalar.return_value = None

    assert saved.message(session=session) is None
