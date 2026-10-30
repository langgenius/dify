from sqlalchemy.orm import Session, sessionmaker

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.snippet_generate_service import SnippetGenerateService
from services.snippet_service import SnippetService
from services.workflow_service import WorkflowService
from tests.unit_tests.core.workflow.knowledge_retrieval_test_utils import make_knowledge_retriever


def make_snippet_service(session_factory: sessionmaker[Session]) -> SnippetService:
    """Compose snippet persistence with SQL repositories sharing one test database."""
    return SnippetService(
        session_maker=session_factory,
        node_executions=DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_factory),
        workflow_runs=DifyAPISQLAlchemyWorkflowRunRepository(session_factory),
    )


def make_snippet_generation_service(
    session_factory: sessionmaker[Session],
    *,
    snippets: SnippetService | None = None,
) -> SnippetGenerateService:
    """Compose snippet execution with the same persistence/session boundary."""
    snippets = snippets or make_snippet_service(session_factory)
    return SnippetGenerateService(
        snippets=snippets,
        workflows=WorkflowService(session_maker=session_factory),
        session_factory=session_factory,
        knowledge_retrieval=make_knowledge_retriever(),
    )
