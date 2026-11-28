"""Composition of the Agent App console use cases."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from repositories.agent.agent_app_repository import AgentAppRepository
from repositories.agent.agent_config_repository import AgentConfigRepository
from repositories.agent.agent_observability_repository import SQLAlchemyAgentObservabilityRepository
from repositories.agent.agent_roster_repository import SQLAlchemyAgentRosterRepository
from repositories.agent.agent_sandbox_repository import AgentSandboxRepository
from repositories.agent.agent_version_repository import SQLAlchemyAgentVersionRepository
from repositories.knowledge_fs_app_bindings import stage_published_agent_knowledge_bindings
from services.agent.agent_app_feature_gateway import AgentAppFeatureValidator
from services.agent.agent_app_service import (
    AgentApiAccessService,
    AgentAppAccessService,
    AgentAppCollectionService,
    AgentAppDeletionService,
    AgentAppDetailService,
    AgentAppFeatureConfigService,
)
from services.agent.app_composer import AgentAppComposer
from services.agent.build_config_gateway import AgentBuildConfigGateway
from services.agent.build_session_service import AgentBuildSessionService
from services.agent.build_snapshot_gateway import AgentBuildSnapshotGateway
from services.agent.composer_tools import list_workspace_dify_tools
from services.agent.config_assets_store import AgentConfigFileReader
from services.agent.config_service import AgentConfigService
from services.agent.console_runtime import AgentConsoleRuntime
from services.agent.home_snapshot_service import create_home_snapshot_client
from services.agent.invite_options import AgentInviteOptionsService
from services.agent.knowledge_gateway import AgentKnowledgeGateway
from services.agent.knowledge_spaces import (
    authorize_composer_knowledge,
    authorize_published_agent_knowledge_bindings,
)
from services.agent.observability_contracts import AgentObservability
from services.agent.sandbox_file_gateway import AgentSandboxFileGateway, create_sandbox_client
from services.agent.sandbox_service import AgentAppSandboxService
from services.agent.version_service import AgentVersionService
from services.app.console_gateway import (
    AgentAppDetailPresentationGateway,
    inherit_agent_webapp_access,
    notify_agent_app_updated,
    notify_app_created,
    notify_app_deleted,
)
from services.app_generate_service import AppGenerateService
from services.app_service import AppService
from services.evaluation_service import EvaluationService
from services.feature_service import FeatureService
from services.file_request_service import FileRequestService
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from services.model_provider.service import ModelProviderService
from services.rbac.agent_list_gateway import AgentListVisibilityGateway
from services.rbac.members import MemberService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection


@dataclass(frozen=True, slots=True)
class AgentAppServices:
    access: AgentAppAccessService
    api_access: AgentApiAccessService
    lifecycle: AgentAppDeletionService
    detail: AgentAppDetailService
    collection: AgentAppCollectionService
    features: AgentAppFeatureConfigService
    sandbox: AgentAppSandboxService
    build_session: AgentBuildSessionService
    composer: AgentAppComposer
    config_assets: AgentConfigService
    knowledge: AgentKnowledgeGateway
    runtime: AgentConsoleRuntime


def _can_restore_version(
    tenant_id: str, *, edition: DeploymentEdition, get_plan: Callable[[str], CloudPlan | None]
) -> bool:
    """Require a paid plan for Cloud restores; other editions do not query billing."""
    return edition != DeploymentEdition.CLOUD or ((plan := get_plan(tenant_id)) is not None and plan.is_paid)


def build_agent_app_repository(*, database_client: sessionmaker[Session]) -> AgentAppRepository:
    """Build the shared Agent App repository with its publication transaction participant."""
    return AgentAppRepository(
        session_factory=database_client,
        stage_evaluation_cleanup=EvaluationService.stage_target_evaluation_cleanup,
        stage_publication_bindings=partial(
            stage_published_agent_knowledge_bindings,
            load_stager=lambda: get_knowledge_fs_runtime(database_client).app_bindings,
        ),
    )


def build_agent_app_services(
    *,
    database_client: sessionmaker[Session],
    rbac_members: MemberService,
    apps: AgentAppRepository,
    config_files: AgentConfigFileReader,
) -> AgentAppServices:
    """Wire Agent App use cases to the shared repositories and their post-commit effects."""
    configs = AgentConfigRepository(session_factory=database_client)
    deletion_service = AgentAppDeletionService(store=apps, notify_deleted=notify_app_deleted)
    detail = AgentAppDetailService(
        store=apps,
        presentation=AgentAppDetailPresentationGateway(members=rbac_members),
        notify_updated=notify_agent_app_updated,
    )
    return AgentAppServices(
        access=AgentAppAccessService(store=apps),
        api_access=AgentApiAccessService(store=apps, notify_updated=notify_agent_app_updated),
        lifecycle=deletion_service,
        detail=detail,
        collection=AgentAppCollectionService(
            store=apps,
            access=AgentListVisibilityGateway(members=rbac_members),
            prepare_creation=AppService.prepare_creation,
            resolve_default_model=partial(
                ModelProviderService().resolve_default_model_selection,
                model_type=ModelType.LLM,
                session_factory=database_client,
            ),
            notify_created=notify_app_created,
            detail=detail,
            inherit_webapp_access=inherit_agent_webapp_access,
        ),
        features=AgentAppFeatureConfigService(features=apps, validator=AgentAppFeatureValidator()),
        runtime=AgentConsoleRuntime(
            session_factory=database_client,
            preview_enabled=FeatureService.is_agent_preview_enabled,
            generate=AppGenerateService.generate,
        ),
        config_assets=AgentConfigService(configs=configs, files=config_files),
        knowledge=AgentKnowledgeGateway(configs=configs),
        composer=AgentAppComposer(
            store=apps,
            authorize_knowledge=partial(authorize_composer_knowledge, session_factory=database_client),
            workspace_tools=list_workspace_dify_tools,
            authorize_publication_bindings=partial(
                authorize_published_agent_knowledge_bindings, session_maker=database_client
            ),
        ),
        build_session=AgentBuildSessionService(
            store=apps,
            collect_resources=enqueue_agent_resource_collection,
            config=AgentBuildConfigGateway(session_factory=database_client),
            snapshots=AgentBuildSnapshotGateway(create_home_snapshot_client),
        ),
        sandbox=AgentAppSandboxService(
            bindings=AgentSandboxRepository(session_factory=database_client, apps=apps),
            files=AgentSandboxFileGateway(
                client_factory=create_sandbox_client,
                file_requests=FileRequestService(),
                files_url=dify_config.FILES_URL,
            ),
        ),
    )


def build_agent_version_service(*, database_client: sessionmaker[Session]) -> AgentVersionService:
    """Wire roster version history with tenant-scoped storage and Cloud plan checks."""
    return AgentVersionService(
        store=SQLAlchemyAgentVersionRepository(session_factory=database_client),
        restore_allowed=lambda tenant_id: _can_restore_version(
            tenant_id, edition=dify_config.DEPLOYMENT_EDITION, get_plan=FeatureService.get_workspace_plan
        ),
    )


def build_agent_invite_options_service(
    *, database_client: sessionmaker[Session], rbac_members: MemberService
) -> AgentInviteOptionsService:
    """Wire the Agent directory query and its shared workspace visibility rules."""
    return AgentInviteOptionsService(
        store=SQLAlchemyAgentRosterRepository(session_factory=database_client),
        visibility=AgentListVisibilityGateway(members=rbac_members),
    )


def build_agent_observability(*, database_client: sessionmaker[Session]) -> AgentObservability:
    """Wire Agent runtime observability for both roster and workflow-only Agents."""
    return SQLAlchemyAgentObservabilityRepository(session_factory=database_client)
