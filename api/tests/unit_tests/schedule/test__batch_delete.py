from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from enums.oauth_client import OAuthClientKind
from models.oauth import OpenAPIOAuthClient
from schedule._batch_delete import delete_in_batches


def _add(session: Session, client_id: str) -> None:
    session.add(
        OpenAPIOAuthClient(
            client_id=client_id,
            kind=OAuthClientKind.PUBLIC,
            display_name="Agent",
            redirect_uris=[],
            grant_types=[],
        )
    )
    session.commit()


def test_deletes_matching_rows_across_batches_and_returns_the_count(sqlite_session: Session) -> None:
    for index in range(5):
        _add(sqlite_session, f"drop_{index}")
    _add(sqlite_session, "keep")

    deleted = delete_in_batches(
        sqlite_session, OpenAPIOAuthClient, OpenAPIOAuthClient.client_id.like("drop_%"), batch_size=2
    )

    assert deleted == 5
    assert sqlite_session.scalars(select(OpenAPIOAuthClient.client_id)).all() == ["keep"]


def test_nothing_matching_deletes_nothing(sqlite_session: Session) -> None:
    _add(sqlite_session, "keep")

    assert (
        delete_in_batches(
            sqlite_session, OpenAPIOAuthClient, OpenAPIOAuthClient.created_at < datetime(2000, 1, 1, tzinfo=UTC)
        )
        == 0
    )
