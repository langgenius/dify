"""Execution extra contents for installed-app messages."""

from collections.abc import Mapping, Sequence

from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository


class InstalledAppMessageRuntime:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._extra_contents: SQLAlchemyExecutionExtraContentRepository = SQLAlchemyExecutionExtraContentRepository(
            session_maker=session_factory
        )

    def get_extra_contents(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]:
        contents = self._extra_contents.get_by_message_ids(message_ids)
        return {
            message_id: [content.model_dump(mode="json", exclude_none=True) for content in items]
            for message_id, items in zip(message_ids, contents, strict=True)
        }
