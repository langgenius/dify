"""Own the read Session for the openapi DSL import rules."""

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from graphon.variables import VariableBase
from machinery.context import RequestContext
from repositories.app.console_repository import require_console_app
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.workflow.definition_repository import WorkflowDefinitionStore
from services.workflow.dsl_import import DslImportStore, DslImportTarget, stored_secret_ids
from services.workflow.graph_check import ResourceCheck, credential_check
from services.workflow.graph_diff import draft_token


class DslImportRepository(DslImportStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory
        self._credential_queries = CredentialQueryRepository(session_factory=session_factory)

    @override
    def load_target(self, context: RequestContext, app_id: str) -> DslImportTarget:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            draft = WorkflowDefinitionStore.get_draft_workflow(app, session=session)
            return DslImportTarget(
                mode=app.mode,
                draft_token=draft_token(draft) if draft else None,
                stored_secret_ids=frozenset(stored_secret_ids(draft)) if draft else frozenset(),
            )

    @override
    @contextmanager
    def credential_check(self, workspace_id: str, environment: Mapping[str, VariableBase]) -> Generator[ResourceCheck]:
        yield credential_check(workspace_id, environment, self._credential_queries)
