"""Bridge pure installed app requests to the existing generation runtime."""

import logging
from collections.abc import Callable, Generator, Mapping
from typing import cast, override

from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account, App
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.conversation_service import ConversationService
from services.installed_app_generation_service import (
    GenerationResponse,
    GenerationStream,
    InstalledAppGenerationRuntime,
)

logger = logging.getLogger(__name__)


class _MoreLikeThisEventStream:
    def __init__(self, source: Generator[Mapping[str, object] | str, None, None]) -> None:
        self._source: Generator[Mapping[str, object] | str, None, None] = source
        self._events: GenerationStream = cast(GenerationStream, CompletionAppGenerator.convert_to_event_stream(source))
        self._closed: bool = False

    def __iter__(self) -> "_MoreLikeThisEventStream":
        return self

    def __next__(self) -> str:
        if self._closed:
            raise StopIteration
        try:
            return next(self._events)
        except BaseException:
            try:
                self.close()
            except BaseException:
                logger.exception("Failed to close the more-like-this response after an error")
            raise

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._events.close()
        finally:
            # Closing an unstarted conversion generator does not reach its source.
            self._source.close()


class AppGenerateServiceRuntime(InstalledAppGenerationRuntime):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def generate(
        self,
        *,
        app_id: str,
        account_id: str,
        args: Mapping[str, object],
        streaming: bool,
    ) -> GenerationResponse:
        conversation_id = args.get("conversation_id")
        app, account = self._load_generation_context(
            app_id=app_id,
            account_id=account_id,
            conversation_id=conversation_id if isinstance(conversation_id, str) else None,
        )
        return self._run_generation(
            lambda session: AppGenerateService.generate(
                session=session,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )
        )

    @override
    def generate_more_like_this(
        self,
        *,
        app_id: str,
        account_id: str,
        message_id: str,
        streaming: bool,
    ) -> GenerationResponse:
        app, account = self._load_generation_context(app_id=app_id, account_id=account_id)

        def generate(session: Session) -> GenerationResponse:
            response = AppGenerateService.generate_more_like_this(
                session=session,
                app_model=app,
                user=account,
                message_id=message_id,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )
            if isinstance(response, Mapping):
                return response
            return _MoreLikeThisEventStream(response)

        return self._run_generation(generate)

    def _load_generation_context(
        self, *, app_id: str, account_id: str, conversation_id: str | None = None
    ) -> tuple[App, Account]:
        with self._session_factory(expire_on_commit=False) as read_session:
            app = read_session.get(App, app_id)
            if app is None:
                raise AppDefinitionUnavailableError(f"App {app_id} no longer exists")
            account = read_session.get(Account, account_id)
            if account is None:
                raise AccountNotFoundError(f"Account {account_id} no longer exists")

            # Resolve the validated chat conversation before a streaming generator
            # is created, preserving the legacy eager 404 and ownership checks.
            if conversation_id:
                ConversationService.get_conversation(
                    app_model=app,
                    conversation_id=conversation_id,
                    user=account,
                    session=read_session,
                )
        return app, account

    def _run_generation(self, generate: Callable[[Session], GenerationResponse]) -> GenerationResponse:
        # Release actor/app reads before the runtime's quota and rate-limit checks.
        # Legacy generators still own their internal database and external I/O.
        response: GenerationResponse | None = None
        try:
            with self._session_factory(expire_on_commit=False) as session:
                response = generate(session)
                session.commit()
        except BaseException:
            if response is not None and not isinstance(response, Mapping):
                try:
                    response.close()
                except BaseException:
                    logger.exception("Failed to close the generation response after an error")
            raise

        return response
