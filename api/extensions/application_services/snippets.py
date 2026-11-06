"""Composition of Snippet use cases and their workflow Agent dependencies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.agent_bindings import build_workflow_agent_service
from extensions.application_services.workflow import build_workflow_execution_dependencies
from services.agent.workflow_resources_gateway import WorkflowAgentSkillReader
from services.skill_management_service import SkillManagementService
from services.workflow.variable_contracts import WorkflowExecutionVariables

if TYPE_CHECKING:
    from services.snippet_dsl_service import SnippetDslService
    from services.snippet_generate_service import SnippetGenerateService
    from services.snippet_service import SnippetService


def build_snippet_generation_service(
    *, database_client: sessionmaker[Session], variables: WorkflowExecutionVariables
) -> SnippetGenerateService:
    from services.snippet_generate_service import SnippetGenerateService
    from services.workflow_service import WorkflowService

    return SnippetGenerateService(
        runtime=build_workflow_execution_dependencies(database_client),
        snippets=build_snippet_service(database_client),
        variables=variables,
        workflows=WorkflowService(database_client, runtime=build_workflow_execution_dependencies(database_client)),
    )


def build_snippet_service(
    session_maker: sessionmaker[Session] | Session | None = None, session: Session | None = None
) -> SnippetService:
    from services.snippet_service import SnippetService

    if isinstance(session_maker, Session):
        session = session_maker
        session_maker = None
    if session is not None:
        session_maker = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    if session_maker is None:
        raise ValueError("SnippetService requires a session or session_maker.")
    return SnippetService(
        session_maker=session_maker,
        session=session,
        agent_bindings=build_workflow_agent_service,
        skills=WorkflowAgentSkillReader(SkillManagementService(session_maker=session_maker)),
    )


def build_snippet_dsl_service(session: Session) -> SnippetDslService:
    from extensions.application_services.workflow import build_workflow_drafts
    from services.snippet_dsl_service import SnippetDslService

    return SnippetDslService(
        session,
        snippets=build_snippet_service(session=session),
        drafts=build_workflow_drafts(
            sessionmaker(bind=session.get_bind(), expire_on_commit=False), import_session=session
        ),
    )
