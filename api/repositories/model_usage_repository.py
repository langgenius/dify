"""Read the stored configuration documents that may reference a model, scoped to one workspace."""

from collections.abc import Sequence
from typing import Any, override

from sqlalchemy import ColumnElement, Row, and_, or_, select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow
from services.model_provider.usage_query import ModelUsageDocument, ModelUsageDocumentQuery, ModelUsageSource

_WORKFLOW_MODES = (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
_MODEL_CONFIG_MODES = (AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT)


class SQLAlchemyModelUsageRepository(ModelUsageDocumentQuery):
    """Filter by workspace and literal text fragments in SQL; callers parse the returned JSON."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_documents(
        self, *, workspace_id: str, model_fragments: Sequence[str], provider_fragment: str
    ) -> list[ModelUsageDocument]:
        def mentions(column: Any) -> ColumnElement[bool]:
            return and_(
                column.contains(provider_fragment, autoescape=True),
                or_(*(column.contains(fragment, autoescape=True) for fragment in model_fragments)),
            )

        documents: list[ModelUsageDocument] = []
        with self._session_factory() as session:
            # Resolve the candidate rows by id first, so the text filter below only reads each app's draft and
            # current documents and never its published history. Workflow-only Agents' hidden backing Apps have
            # the agent mode and are not selected.
            apps = session.execute(
                select(App.id, App.name, App.mode, App.maintainer, App.workflow_id, App.app_model_config_id).where(
                    App.tenant_id == workspace_id,
                    App.status == AppStatus.NORMAL,
                    App.mode.in_(_WORKFLOW_MODES + _MODEL_CONFIG_MODES),
                )
            ).all()
            drafts = {app.id: app for app in apps if app.mode in _WORKFLOW_MODES}
            published = {app.workflow_id: app for app in drafts.values() if app.workflow_id}
            configs = {
                app.app_model_config_id: app
                for app in apps
                if app.mode in _MODEL_CONFIG_MODES and app.app_model_config_id
            }
            if drafts:
                workflows = select(Workflow.id, Workflow.app_id, Workflow.version, Workflow.graph).where(
                    Workflow.tenant_id == workspace_id,
                    or_(
                        and_(Workflow.version == Workflow.VERSION_DRAFT, Workflow.app_id.in_(list(drafts))),
                        Workflow.id.in_(list(published)),
                    ),
                    mentions(Workflow.graph),
                )
                for workflow_id, app_id, version, graph in session.execute(workflows):
                    draft = version == Workflow.VERSION_DRAFT
                    # A published row can only come from the current-version branch, so it is always in ``published``.
                    app = drafts.get(app_id) if draft else published[workflow_id]
                    if app is not None and app.id == app_id:
                        source = ModelUsageSource.WORKFLOW_DRAFT if draft else ModelUsageSource.WORKFLOW_PUBLISHED
                        documents.append(_document(app, source, graph))
            if configs:
                model_configs = select(AppModelConfig.id, AppModelConfig.app_id, AppModelConfig.model).where(
                    AppModelConfig.id.in_(list(configs)),
                    mentions(AppModelConfig.model),
                )
                for config_id, app_id, content in session.execute(model_configs):
                    app = configs[config_id]
                    if app.id == app_id and content is not None:
                        documents.append(_document(app, ModelUsageSource.APP_MODEL_CONFIG, content))
        return documents


def _document(app: Row[Any], source: ModelUsageSource, content: str) -> ModelUsageDocument:
    return ModelUsageDocument(
        app_id=app.id,
        app_name=app.name,
        app_mode=app.mode.value,
        app_maintainer=app.maintainer,
        source=source,
        content=content,
    )
