"""Bridge pure installed app requests to the existing generation runtime."""

import logging
from collections.abc import Mapping
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account, App
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.installed_app_completion_service import CompletionResponse, InstalledAppCompletionRuntime

logger = logging.getLogger(__name__)


class AppGenerateServiceCompletionRuntime(InstalledAppCompletionRuntime):
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
    ) -> CompletionResponse:
        with self._session_factory(expire_on_commit=False) as read_session:
            app = read_session.get(App, app_id)
            if app is None:
                raise AppDefinitionUnavailableError(f"App {app_id} no longer exists")
            account = read_session.get(Account, account_id)
            if account is None:
                raise AccountNotFoundError(f"Account {account_id} no longer exists")

        # Release actor/app reads before the runtime's quota and rate-limit checks.
        # Legacy generators still own their internal database and external I/O.
        response: CompletionResponse | None = None
        try:
            with self._session_factory(expire_on_commit=False) as session:
                response = AppGenerateService.generate(
                    session=session,
                    app_model=app,
                    user=account,
                    args=args,
                    invoke_from=InvokeFrom.EXPLORE,
                    streaming=streaming,
                )
                session.commit()
        except BaseException:
            if response is not None and not isinstance(response, Mapping):
                try:
                    response.close()
                except BaseException:
                    logger.exception("Failed to close the generation response after an error")
            raise

        return response
