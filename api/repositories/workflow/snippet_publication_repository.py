"""Short Snippet read/write transactions exposing persistence operations to the use case."""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
from repositories.workflow.definition_repository import workflow_snapshot
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.contracts import WorkflowSnapshot


@dataclass
class SnippetPublicationTransaction:
    session: Session
    snippet: CustomizedSnippet
    draft: WorkflowSnapshot
    bindings: WorkflowAgentBindingRepository

    def create_version(self, *, account_id: str) -> Workflow:
        workflow = Workflow.new(
            tenant_id=self.draft.tenant_id,
            app_id=self.draft.app_id,
            type=WorkflowType.WORKFLOW.value,
            version=str(datetime.now(UTC).replace(tzinfo=None)),
            graph=self.draft.graph,
            features=self.draft.features,
            created_by=account_id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
            kind=WorkflowKind.SNIPPET.value,
        )
        # Copy serialized values without external resolution or decryption.
        workflow._rag_pipeline_variables = self.draft.rag_pipeline_variables
        self.session.add(workflow)
        self.session.flush()
        return workflow

    def activate(self, workflow: Workflow, *, account_id: str) -> None:
        self.snippet.version += 1
        self.snippet.is_published = True
        self.snippet.workflow_id = workflow.id
        self.snippet.updated_by = account_id
        self.session.flush()


class SnippetPublicationRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @staticmethod
    def _draft(tenant_id: str, snippet_id: str):
        return select(Workflow).where(
            Workflow.tenant_id == tenant_id,
            Workflow.app_id == snippet_id,
            Workflow.kind == WorkflowKind.SNIPPET,
            Workflow.version == Workflow.VERSION_DRAFT,
        )

    @contextmanager
    def draft(
        self, *, tenant_id: str, snippet_id: str
    ) -> Generator[tuple[WorkflowSnapshot, WorkflowAgentBindingRepository], None, None]:
        with self._sessions() as session:
            draft = session.scalar(self._draft(tenant_id, snippet_id))
            if draft is None:
                raise ValueError("No valid workflow found.")
            yield workflow_snapshot(draft), WorkflowAgentBindingRepository(session)

    @contextmanager
    def publication(self, source: WorkflowSnapshot) -> Generator[SnippetPublicationTransaction, None, None]:
        with self._sessions(expire_on_commit=False) as session, session.begin():
            snippet = session.scalar(
                select(CustomizedSnippet)
                .where(CustomizedSnippet.tenant_id == source.tenant_id, CustomizedSnippet.id == source.app_id)
                .with_for_update()
            )
            draft = session.scalar(self._draft(source.tenant_id, source.app_id).with_for_update())
            if snippet is None or draft is None or workflow_snapshot(draft) != source:
                raise WorkflowHashNotEqualError()
            yield SnippetPublicationTransaction(
                session, snippet, workflow_snapshot(draft), WorkflowAgentBindingRepository(session)
            )
