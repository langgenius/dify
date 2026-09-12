"""Bridge admitted trial references to the existing ORM generation runtime.

AppGenerateService and its generators still own their internal database and
provider operations. Keep that compatibility here until their migration.
"""

import logging
from collections.abc import Mapping
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account, App
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.trial_app_access_service import TrialAppRef
from services.trial_app_generation_service import GenerationResponse, TrialAppGenerationRuntime

logger = logging.getLogger(__name__)


class AppGenerateServiceRuntime(TrialAppGenerationRuntime):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def generate(
        self, *, app: TrialAppRef, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> GenerationResponse:
        with self._session_factory(expire_on_commit=False) as read_session:
            app_model = read_session.get(App, app.app_id)
            if app_model is None or app_model.tenant_id != app.tenant_id:
                raise AppDefinitionUnavailableError(f"App {app.app_id} no longer exists in tenant {app.tenant_id}")
            if app_model.mode != app.app_mode:
                raise AppDefinitionUnavailableError(
                    f"App {app.app_id} mode changed from {app.app_mode} to {app_model.mode} after admission"
                )
            account = read_session.get(Account, account_id)
            if account is None:
                raise AccountNotFoundError(f"Account {account_id} no longer exists")

        response: GenerationResponse | None = None
        try:
            # Release context reads before quota/provider I/O. Legacy generation
            # receives its own session, never the admission or usage transaction.
            with self._session_factory(expire_on_commit=False) as session:
                response = AppGenerateService.generate(
                    app_model=app_model,
                    user=account,
                    args=args,
                    invoke_from=InvokeFrom.EXPLORE,
                    session=session,
                    streaming=streaming,
                )
                session.commit()
        except BaseException:
            if response is not None and not isinstance(response, Mapping):
                try:
                    response.close()
                except BaseException:
                    logger.exception("Failed to close trial generation response for app %s", app.app_id)
            raise
        return response
