"""Load detached app-preview data without trial or account admission policy."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import cast, override

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.uuid_utils import is_valid_uuid
from models.account import Account, Tenant
from models.dataset import Dataset
from models.model import App, AppModelConfig, Site, load_annotation_reply_config
from models.tools import ApiToolProvider
from models.workflow import Workflow
from repositories.app_definition_query_repository import map_site_configuration
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_preview_details_service import (
    AppPreviewAccount,
    AppPreviewAudit,
    AppPreviewDetail,
    AppPreviewDetailRecord,
    AppPreviewDetailSite,
    AppPreviewDetailsQuery,
    AppPreviewObject,
    AppPreviewTag,
    AppPreviewWorkflow,
    AppPreviewWorkflowRecord,
)
from services.app_preview_query_service import (
    AppPreviewDataset,
    AppPreviewQuery,
    AppPreviewRef,
    AppPreviewSite,
    AppPreviewSiteUnavailableError,
    AppPreviewUnavailableError,
)


class AppPreviewQueryRepository(AppPreviewQuery, AppPreviewDetailsQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get_app(self, *, app_id: str) -> AppPreviewRef | None:
        with self._session_factory() as session:
            row = session.execute(
                select(App.id, App.tenant_id).where(App.id == app_id, App.status == "normal")
            ).one_or_none()
            if row is None:
                return None
            return AppPreviewRef(app_id=row.id, tenant_id=row.tenant_id)

    @override
    def get_site(self, *, app: AppPreviewRef) -> AppPreviewSite | None:
        with self._session_factory() as session:
            row = session.execute(
                select(Site, Tenant.status)
                .select_from(App)
                .join(Site, Site.app_id == App.id)
                .outerjoin(Tenant, Tenant.id == App.tenant_id)
                .where(App.id == app.app_id, App.tenant_id == app.tenant_id, App.status == "normal")
                .limit(1)
            ).first()
            if row is None:
                return None
            site, owner_status = row
            return AppPreviewSite(
                configuration=map_site_configuration(site),
                owner_status=owner_status.value if owner_status is not None else None,
            )

    @override
    def get_datasets(self, *, app: AppPreviewRef, ids: Sequence[str]) -> tuple[AppPreviewDataset, ...] | None:
        with self._session_factory() as session:
            app_id = session.scalar(
                select(App.id).where(App.id == app.app_id, App.tenant_id == app.tenant_id, App.status == "normal")
            )
            if app_id is None:
                return None
            if not ids:
                return ()
            datasets = session.scalars(select(Dataset).where(Dataset.id.in_(ids), Dataset.tenant_id == app.tenant_id))
            return tuple(
                AppPreviewDataset(
                    id=dataset.id,
                    name=dataset.name,
                    description=dataset.description,
                    permission=dataset.permission.value if dataset.permission is not None else None,
                    data_source_type=dataset.data_source_type.value if dataset.data_source_type is not None else None,
                    indexing_technique=dataset.indexing_technique.value
                    if dataset.indexing_technique is not None
                    else None,
                    created_by=dataset.created_by,
                    created_at=dataset.created_at,
                )
                for dataset in datasets
            )

    @override
    def get_detail(self, *, app: AppPreviewRef, account_id: str) -> AppPreviewDetailRecord:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            account = session.get(Account, account_id)
            if account is None:
                raise AccountNotFoundError(f"Account {account_id} no longer exists")
            model_config = self._get_model_config(session=session, app=app_model)
            workflow = self._get_workflow(session=session, app=app_model)
            agent_mode = model_config.agent_mode_dict if model_config is not None else None
            tools = tuple(cast(Sequence[AppPreviewObject], agent_mode.get("tools", []))) if agent_mode else ()
            existing_api_provider_ids = self._get_existing_api_provider_ids(
                session=session, tenant_id=app.tenant_id, tools=tools
            )
            configuration = self._map_model_config(session=session, model_config=model_config)
            site = session.scalar(select(Site).where(Site.app_id == app.app_id).limit(1))
            if site is None:
                raise AppPreviewSiteUnavailableError(f"Site for app {app.app_id} is unavailable")

            detail = AppPreviewDetail(
                id=app_model.id,
                name=app_model.name,
                description=app_model.description,
                mode=app_model.mode,
                icon_type=app_model.icon_type.value if app_model.icon_type is not None else None,
                icon=app_model.icon,
                icon_background=app_model.icon_background,
                enable_site=app_model.enable_site,
                enable_api=app_model.enable_api,
                model_config=configuration,
                workflow=self._map_workflow_summary(workflow),
                use_icon_as_answer_icon=app_model.use_icon_as_answer_icon,
                max_active_requests=app_model.max_active_requests,
                created_by=app_model.created_by,
                created_at=app_model.created_at,
                updated_by=app_model.updated_by,
                updated_at=app_model.updated_at,
                deleted_tools=(),
                tags=tuple(
                    AppPreviewTag(id=tag.id, name=tag.name, type=tag.type)
                    for tag in app_model.tags_with_session(session=session)
                ),
                site=self._map_site(site),
            )

            return AppPreviewDetailRecord(detail=detail, existing_api_provider_ids=existing_api_provider_ids)

    @override
    def get_workflow(self, *, app: AppPreviewRef) -> AppPreviewWorkflowRecord:
        with self._session_factory() as session:
            app_model = self._get_app(session=session, app=app)
            workflow = self._get_workflow(session=session, app=app_model)
            if workflow is None:
                raise AppDefinitionUnavailableError(f"Workflow for app {app.app_id} is unavailable")
            created_by = self._map_account(workflow.get_created_by_account(session=session))
            updated_by = self._map_account(workflow.get_updated_by_account(session=session))
            tool_published = workflow.get_tool_published(session=session)

        # Legacy feature normalization mutates the model property. Keep that
        # response-only conversion on the detached object after all queries finish.
        detail = AppPreviewWorkflow(
            id=workflow.id,
            graph=cast(AppPreviewObject, workflow.graph_dict),
            features=cast(AppPreviewObject, workflow.features_dict),
            hash=workflow.unique_hash,
            version=workflow.version,
            marked_name=workflow.marked_name,
            marked_comment=workflow.marked_comment,
            created_by=created_by,
            created_at=workflow.created_at,
            updated_by=updated_by,
            updated_at=workflow.updated_at,
            tool_published=tool_published,
            environment_variables=(),
            conversation_variables=tuple(
                cast(
                    AppPreviewObject,
                    {**variable.model_dump(mode="json"), "value_type": str(variable.value_type.exposed_type())},
                )
                for variable in workflow.conversation_variables
            ),
            rag_pipeline_variables=tuple(
                cast(AppPreviewObject, variable) for variable in workflow.rag_pipeline_variables
            ),
        )
        return AppPreviewWorkflowRecord(
            workflow=detail,
            tenant_id=workflow.tenant_id,
            environment_variables_json=workflow._environment_variables,
        )

    @staticmethod
    def _get_existing_api_provider_ids(
        *, session: Session, tenant_id: str, tools: Sequence[AppPreviewObject]
    ) -> frozenset[str]:
        provider_ids = {
            provider_id
            for tool in tools
            if len(tool) >= 4
            and tool.get("provider_type") == ToolProviderType.API
            and isinstance(provider_id := tool.get("provider_id"), str)
            and is_valid_uuid(provider_id)
        }
        if not provider_ids:
            return frozenset()
        return frozenset(
            session.scalars(
                select(ApiToolProvider.id).where(
                    ApiToolProvider.tenant_id == tenant_id, ApiToolProvider.id.in_(provider_ids)
                )
            )
        )

    @staticmethod
    def _get_app(*, session: Session, app: AppPreviewRef) -> App:
        app_model = session.scalar(
            select(App).where(App.id == app.app_id, App.tenant_id == app.tenant_id, App.status == "normal")
        )
        if app_model is None:
            raise AppPreviewUnavailableError(f"App {app.app_id} is no longer available in tenant {app.tenant_id}")
        return app_model

    @staticmethod
    def _get_model_config(*, session: Session, app: App) -> AppModelConfig | None:
        if app.app_model_config_id is None:
            return None
        config = session.scalar(
            select(AppModelConfig).where(
                AppModelConfig.id == app.app_model_config_id,
                AppModelConfig.app_id == app.id,
            )
        )
        if (
            config is None
            and session.scalar(select(AppModelConfig.id).where(AppModelConfig.id == app.app_model_config_id))
            is not None
        ):
            raise AppDefinitionUnavailableError(
                f"Model config {app.app_model_config_id} does not belong to app {app.id}"
            )
        return config

    @staticmethod
    def _get_workflow(*, session: Session, app: App) -> Workflow | None:
        if app.workflow_id is None:
            return None
        workflow = session.scalar(
            select(Workflow).where(
                Workflow.id == app.workflow_id,
                Workflow.app_id == app.id,
                Workflow.tenant_id == app.tenant_id,
            )
        )
        if workflow is None and session.scalar(select(Workflow.id).where(Workflow.id == app.workflow_id)) is not None:
            raise AppDefinitionUnavailableError(f"Workflow {app.workflow_id} does not belong to app {app.id}")
        return workflow

    @staticmethod
    def _map_model_config(
        *, session: Session, model_config: AppModelConfig | None
    ) -> dict[str, JsonValue | datetime] | None:
        if model_config is None:
            return None
        configuration = model_config.to_dict(
            annotation_reply=load_annotation_reply_config(session, model_config.app_id)
        )
        result: dict[str, JsonValue | datetime] = dict(cast(Mapping[str, JsonValue], configuration))
        result.update(
            created_by=model_config.created_by,
            created_at=model_config.created_at,
            updated_by=model_config.updated_by,
            updated_at=model_config.updated_at,
        )
        return result

    @staticmethod
    def _map_workflow_summary(workflow: Workflow | None) -> AppPreviewAudit | None:
        if workflow is None:
            return None
        return AppPreviewAudit(
            id=workflow.id,
            created_by=workflow.created_by,
            created_at=workflow.created_at,
            updated_by=workflow.updated_by,
            updated_at=workflow.updated_at,
        )

    @staticmethod
    def _map_account(account: Account | None) -> AppPreviewAccount | None:
        if account is None:
            return None
        return AppPreviewAccount(id=account.id, name=account.name, email=account.email)

    @staticmethod
    def _map_site(site: Site) -> AppPreviewDetailSite:
        return AppPreviewDetailSite(
            code=site.code,
            title=site.title,
            icon_type=site.icon_type.value if site.icon_type is not None else None,
            icon=site.icon,
            icon_background=site.icon_background,
            description=site.description,
            default_language=site.default_language,
            chat_color_theme=site.chat_color_theme,
            chat_color_theme_inverted=site.chat_color_theme_inverted,
            customize_domain=site.customize_domain,
            copyright=site.copyright,
            privacy_policy=site.privacy_policy,
            input_placeholder=site.input_placeholder,
            custom_disclaimer=site.custom_disclaimer,
            customize_token_strategy=site.customize_token_strategy.value
            if site.customize_token_strategy is not None
            else None,
            prompt_public=site.prompt_public,
            show_workflow_steps=site.show_workflow_steps,
            use_icon_as_answer_icon=site.use_icon_as_answer_icon,
            created_by=site.created_by,
            created_at=site.created_at,
            updated_by=site.updated_by,
            updated_at=site.updated_at,
        )
