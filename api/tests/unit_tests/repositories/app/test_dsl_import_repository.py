from collections.abc import Sequence

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.helper import encrypter
from graphon.variables import SecretVariable, StringVariable, VariableBase
from machinery.context import RequestContext
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.app.dsl_import_repository import DslImportRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.workflow import graph_check
from services.workflow.dsl_import import DslImportTarget
from services.workflow.graph_diff import draft_token
from services.workflow_service import WorkflowService

_CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
_START: dict[str, object] = {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}


@pytest.fixture(autouse=True)
def _identity_secret_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep secret variables readable without the workspace key provider."""
    monkeypatch.setattr(encrypter, "encrypt_token", lambda **kwargs: kwargs["token"])
    monkeypatch.setattr(encrypter, "decrypt_token", lambda **kwargs: kwargs["token"])


def _add_app(session: Session, *, tenant_id: str = "workspace-1", mode: AppMode = AppMode.WORKFLOW) -> None:
    session.add(App(id="app-1", tenant_id=tenant_id, name="a", mode=mode, enable_site=True, enable_api=True))
    session.commit()


def _add_draft(session: Session, environment_variables: Sequence[VariableBase] = ()) -> Workflow:
    draft = Workflow.new(
        tenant_id="workspace-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="account-1",
        environment_variables=environment_variables,
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add(draft)
    session.commit()
    return draft


def test_load_target_reads_the_draft_token_and_its_secret_ids(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _add_app(sqlite_session, mode=AppMode.ADVANCED_CHAT)
    draft = _add_draft(
        sqlite_session,
        [
            SecretVariable(id="s-1", name="KEY", value="plain", selector=["env", "KEY"]),
            StringVariable(id="v-1", name="NAME", value="x", selector=["env", "NAME"]),
        ],
    )

    target = DslImportRepository(session_factory=sqlite_session_factory).load_target(_CONTEXT, "app-1")

    assert target == DslImportTarget(
        mode=AppMode.ADVANCED_CHAT, draft_token=draft_token(draft), stored_secret_ids=frozenset({"s-1"})
    )


def test_load_target_without_a_draft_has_no_token_and_no_secrets(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _add_app(sqlite_session)

    target = DslImportRepository(session_factory=sqlite_session_factory).load_target(_CONTEXT, "app-1")

    assert target == DslImportTarget(mode=AppMode.WORKFLOW, draft_token=None, stored_secret_ids=frozenset())


def test_load_target_refuses_an_app_outside_the_workspace(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _add_app(sqlite_session, tenant_id="workspace-2")

    with pytest.raises(ConsoleAppNotFoundError):
        DslImportRepository(session_factory=sqlite_session_factory).load_target(_CONTEXT, "app-1")


def test_credential_check_answers_inside_its_context(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    # `WorkflowService()` builds its sessions from db.engine; hand it the test database instead.
    monkeypatch.setattr(graph_check, "WorkflowService", lambda: WorkflowService(sqlite_session_factory))

    with DslImportRepository(session_factory=sqlite_session_factory).credential_check("workspace-1", {}) as check:
        assert check(_START) is None
