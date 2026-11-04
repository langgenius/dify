"""Look up LLM references through the production composition: real repository, SQLite, and provider identity."""

import json
from collections.abc import Callable, Mapping

import pytest
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import App, AppMode, AppModelConfig
from repositories.model_usage_repository import SQLAlchemyModelUsageRepository
from services.enterprise.base import EnterpriseRequest
from services.model_provider.usage_adapters import ConsoleAppVisibility, PluginModelProviderIdentity
from services.model_provider.usage_query import ModelUsage, ModelUsageList, ModelUsageQueryService, ModelUsageSource
from tests.helpers.unit.model_factories import make_app, make_workflow
from tests.helpers.unit.rbac_fakes import RBACTransport
from tests.helpers.unit.repositories.app.console_visibility import UNADDRESSABLE_IN_WORKSPACE, MakeUnaddressable

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
OTHER_WORKSPACE_ID = "11111111-1111-4111-8111-111111111112"
OPENAI = "langgenius/openai/openai"
GPT = "gpt-4o"


def _context(workspace_id: str = WORKSPACE_ID) -> RequestContext:
    return RequestContext(request_id="request", trace_id=None, account_id="account", active_workspace_id=workspace_id)


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session]) -> ModelUsageQueryService:
    return ModelUsageQueryService(
        documents=SQLAlchemyModelUsageRepository(session_factory=sqlite_session_factory),
        providers=PluginModelProviderIdentity(),
        visibility=ConsoleAppVisibility(),
    )


def _listed(
    service: ModelUsageQueryService, *, workspace_id: str = WORKSPACE_ID, provider: str = OPENAI, model: str = GPT
) -> list[ModelUsage]:
    """Run the lookup without RBAC, where every matching app is visible and nothing is withheld."""
    result = service.list_llm_usages(_context(workspace_id), provider=provider, model=model)
    assert result.inaccessible_count == 0
    return result.usages


def _model(provider: str = OPENAI, name: str = GPT) -> dict[str, object]:
    return {"provider": provider, "name": name, "mode": "chat", "completion_params": {}}


def _node(node_id: str, node_type: str, title: str, **data: object) -> dict[str, object]:
    return {"id": node_id, "type": "custom", "data": {"type": node_type, "title": title, **data}}


def _graph(*nodes: Mapping[str, object]) -> dict[str, object]:
    return {"nodes": list(nodes), "edges": []}


def _add_workflow_app(
    session: Session,
    *,
    app_id: str,
    draft: Mapping[str, object] | str,
    published: Mapping[str, object] | None = None,
    workspace_id: str = WORKSPACE_ID,
    mode: AppMode = AppMode.WORKFLOW,
    name: str = "Workflow app",
    maintainer: str | None = None,
) -> App:
    app = make_app(app_id=app_id, tenant_id=workspace_id, name=name, mode=mode, maintainer=maintainer)
    session.add(make_workflow(tenant_id=workspace_id, app_id=app_id, graph=draft))
    if published is not None:
        workflow = make_workflow(tenant_id=workspace_id, app_id=app_id, version="2026-01-01 00:00:00", graph=published)
        session.add(workflow)
        app.workflow_id = workflow.id
    session.add(app)
    return app


def _add_chat_app(
    session: Session, *, app_id: str, model: Mapping[str, object], workspace_id: str = WORKSPACE_ID
) -> App:
    config = AppModelConfig(app_id=app_id, model=json.dumps(model))
    session.add(config)
    session.flush()
    app = make_app(app_id=app_id, tenant_id=workspace_id, name="Chat app", app_model_config_id=config.id)
    session.add(app)
    return app


def _persist(session_factory: sessionmaker[Session], build: Callable[[Session], object]) -> None:
    with session_factory() as session:
        build(session)
        session.commit()


def _usage(
    app: App,
    source: ModelUsageSource,
    node: tuple[str, str, str] | None = None,
) -> ModelUsage:
    node_id, node_title, node_type = node if node is not None else (None, None, None)
    return ModelUsage(
        app_id=app.id,
        app_name=app.name,
        app_mode=app.mode.value,
        source=source,
        node_id=node_id,
        node_title=node_title,
        node_type=node_type,
    )


class TestWorkflowSources:
    def test_lists_draft_and_current_published_nodes_but_not_history(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        apps: list[App] = []

        def build(session: Session) -> None:
            app = _add_workflow_app(
                session,
                app_id="22222222-2222-4222-8222-222222222221",
                draft=_graph(_node("llm-1", "llm", "Writer", model=_model())),
                published=_graph(_node("qc-1", "question-classifier", "Router", model=_model())),
            )
            session.add(
                make_workflow(
                    tenant_id=WORKSPACE_ID,
                    app_id=app.id,
                    version="2025-01-01 00:00:00",
                    graph=_graph(_node("old-llm", "llm", "Old", model=_model())),
                )
            )
            apps.append(app)

        _persist(sqlite_session_factory, build)

        usages = _listed(service)

        assert usages == [
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("llm-1", "Writer", "llm")),
            _usage(apps[0], ModelUsageSource.WORKFLOW_PUBLISHED, ("qc-1", "Router", "question-classifier")),
        ]

    def test_skips_apps_that_use_the_model_only_in_earlier_published_versions(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        other = _model(name="gpt-4.1")

        def build(session: Session) -> None:
            app = _add_workflow_app(
                session,
                app_id="22222222-2222-4222-8222-222222222226",
                draft=_graph(_node("llm-1", "llm", "Writer", model=other)),
                published=_graph(_node("llm-1", "llm", "Writer", model=other)),
            )
            for version in ("2025-01-01 00:00:00", "2025-06-01 00:00:00"):
                session.add(
                    make_workflow(
                        tenant_id=WORKSPACE_ID,
                        app_id=app.id,
                        version=version,
                        graph=_graph(_node("llm-1", "llm", "Writer", model=_model())),
                    )
                )

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []

    def test_lists_parameter_extractor_inside_iteration_of_chatflow(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        apps: list[App] = []
        iteration_child = _node("pe-1", "parameter-extractor", "Extract", model=_model(), isInIteration=True)
        iteration_child["parentId"] = "iteration-1"

        def build(session: Session) -> None:
            apps.append(
                _add_workflow_app(
                    session,
                    app_id="22222222-2222-4222-8222-222222222222",
                    mode=AppMode.ADVANCED_CHAT,
                    draft=_graph(_node("iteration-1", "iteration", "Loop"), iteration_child),
                )
            )

        _persist(sqlite_session_factory, build)

        assert _listed(service) == [
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("pe-1", "Extract", "parameter-extractor")),
        ]

    def test_lists_knowledge_retrieval_only_where_its_llm_is_active(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        apps: list[App] = []
        nodes = [
            _node(
                "kr-single",
                "knowledge-retrieval",
                "Single",
                retrieval_mode="single",
                single_retrieval_config={"model": _model()},
            ),
            _node(
                "kr-stale",
                "knowledge-retrieval",
                "Stale",
                retrieval_mode="multiple",
                single_retrieval_config={"model": _model()},
                metadata_filtering_mode="manual",
                metadata_model_config=_model(),
            ),
            _node(
                "kr-metadata",
                "knowledge-retrieval",
                "Metadata",
                retrieval_mode="multiple",
                metadata_filtering_mode="automatic",
                metadata_model_config=_model(),
            ),
            _node(
                "kr-both",
                "knowledge-retrieval",
                "Both",
                retrieval_mode="single",
                single_retrieval_config={"model": _model()},
                metadata_filtering_mode="automatic",
                metadata_model_config=_model(),
            ),
        ]

        def build(session: Session) -> None:
            apps.append(_add_workflow_app(session, app_id="22222222-2222-4222-8222-222222222223", draft=_graph(*nodes)))

        _persist(sqlite_session_factory, build)

        assert _listed(service) == [
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("kr-single", "Single", "knowledge-retrieval")),
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("kr-metadata", "Metadata", "knowledge-retrieval")),
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("kr-both", "Both", "knowledge-retrieval")),
        ]

    def test_ignores_unreadable_graphs_and_nodes_without_model_selection(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        def build(session: Session) -> None:
            _add_workflow_app(session, app_id="22222222-2222-4222-8222-222222222224", draft='{"gpt-4o": ')
            _add_workflow_app(
                session,
                app_id="22222222-2222-4222-8222-222222222225",
                draft=_graph(_node("code-1", "code", "gpt-4o", code="openai gpt-4o")),
            )

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []


class TestAppLevelSources:
    def test_lists_simple_app_model_config(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        apps: list[App] = []
        _persist(
            sqlite_session_factory,
            lambda session: apps.append(
                _add_chat_app(session, app_id="33333333-3333-4333-8333-333333333331", model=_model())
            ),
        )

        assert _listed(service) == [
            _usage(apps[0], ModelUsageSource.APP_MODEL_CONFIG),
        ]

    def test_ignores_model_settings_kept_by_workflow_apps(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """A chatflow runs its graph; a model left in its app model configuration is not a usage."""

        def build(session: Session) -> None:
            config = AppModelConfig(app_id="33333333-3333-4333-8333-333333333332", model=json.dumps(_model()))
            session.add(config)
            session.flush()
            app = _add_workflow_app(
                session,
                app_id="33333333-3333-4333-8333-333333333332",
                mode=AppMode.ADVANCED_CHAT,
                draft=_graph(_node("llm-1", "llm", "LLM", model=_model(name="gpt-4.1"))),
            )
            app.app_model_config_id = config.id

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []


class TestMatching:
    def test_requires_exact_model_name_and_same_provider(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        def build(session: Session) -> None:
            _add_workflow_app(
                session,
                app_id="55555555-5555-4555-8555-555555555551",
                draft=_graph(
                    _node("other-name", "llm", "Prefix", model=_model(name="gpt-4o-mini")),
                    _node(
                        "other-provider", "llm", "Azure", model=_model(provider="langgenius/azure_openai/azure_openai")
                    ),
                ),
            )
            _add_chat_app(
                session,
                app_id="55555555-5555-4555-8555-555555555552",
                model=_model(provider="langgenius/openrouter/openrouter"),
            )

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []

    @pytest.mark.parametrize(("stored", "requested"), [("openai", OPENAI), (OPENAI, "openai")])
    def test_matches_legacy_short_provider_names(
        self,
        service: ModelUsageQueryService,
        sqlite_session_factory: sessionmaker[Session],
        stored: str,
        requested: str,
    ) -> None:
        apps: list[App] = []
        _persist(
            sqlite_session_factory,
            lambda session: apps.append(
                _add_chat_app(session, app_id="55555555-5555-4555-8555-555555555554", model=_model(provider=stored))
            ),
        )

        assert _listed(service, provider=requested) == [
            _usage(apps[0], ModelUsageSource.APP_MODEL_CONFIG),
        ]

    def test_matches_model_names_that_json_escapes(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        apps: list[App] = []
        name = "通义-千问"
        _persist(
            sqlite_session_factory,
            lambda session: apps.append(
                _add_workflow_app(
                    session,
                    app_id="55555555-5555-4555-8555-555555555555",
                    draft=_graph(_node("llm-1", "llm", "LLM", model=_model(name=name))),
                )
            ),
        )

        assert _listed(service, model=name) == [
            _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("llm-1", "LLM", "llm")),
        ]

    def test_invalid_requested_provider_matches_nothing(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        _persist(
            sqlite_session_factory,
            lambda session: _add_chat_app(
                session, app_id="55555555-5555-4555-8555-555555555556", model=_model(provider="Not A Provider")
            ),
        )

        assert _listed(service, provider="Not A Provider") == []


class TestWorkspaceScope:
    def test_excludes_every_source_of_other_workspaces(
        self, service: ModelUsageQueryService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        def build(session: Session) -> None:
            _add_workflow_app(
                session,
                app_id="66666666-6666-4666-8666-666666666661",
                workspace_id=OTHER_WORKSPACE_ID,
                draft=_graph(_node("llm-1", "llm", "LLM", model=_model())),
                published=_graph(_node("llm-1", "llm", "LLM", model=_model())),
            )
            _add_chat_app(
                session, app_id="66666666-6666-4666-8666-666666666662", workspace_id=OTHER_WORKSPACE_ID, model=_model()
            )

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []
        assert len(_listed(service, workspace_id=OTHER_WORKSPACE_ID)) == 3

    @pytest.mark.parametrize("make_unaddressable", UNADDRESSABLE_IN_WORKSPACE)
    def test_excludes_apps_console_cannot_address(
        self,
        service: ModelUsageQueryService,
        sqlite_session_factory: sessionmaker[Session],
        make_unaddressable: MakeUnaddressable,
    ) -> None:
        app_ids = ("66666666-6666-4666-8666-666666666664", "66666666-6666-4666-8666-666666666665")

        def build(session: Session) -> None:
            _add_chat_app(session, app_id=app_ids[0], model=_model())
            _add_workflow_app(session, app_id=app_ids[1], draft=_graph(_node("llm-1", "llm", "LLM", model=_model())))
            session.flush()
            for app_id in app_ids:
                make_unaddressable(session, app_id)

        _persist(sqlite_session_factory, build)

        assert _listed(service) == []


class TestVisibility:
    @staticmethod
    def _enable_rbac(
        monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], whitelist: list[JsonValue]
    ) -> RBACTransport:
        config_overrides(RBAC_ENABLED=True)
        transport = RBACTransport(
            responses={
                "/rbac/my-permissions": {"workspace": {"permission_keys": ["plugin.plugin_preferences"]}},
                "/rbac/apps/whitelist/resources": {"unrestricted": False, "resource_ids": whitelist},
            }
        )
        monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
        return transport

    def test_lists_only_apps_the_caller_can_view_and_counts_the_rest(
        self,
        service: ModelUsageQueryService,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
    ) -> None:
        graph = _graph(_node("llm-1", "llm", "LLM", model=_model()))
        apps: list[App] = []

        def build(session: Session) -> None:
            apps.append(_add_workflow_app(session, app_id="77777777-7777-4777-8777-777777777771", draft=graph))
            apps.append(
                _add_workflow_app(
                    session, app_id="77777777-7777-4777-8777-777777777772", draft=graph, maintainer="account"
                )
            )
            _add_workflow_app(
                session,
                app_id="77777777-7777-4777-8777-777777777773",
                draft=graph,
                published=graph,
                maintainer="someone-else",
            )

        _persist(sqlite_session_factory, build)
        transport = self._enable_rbac(monkeypatch, config_overrides, whitelist=[apps[0].id])

        assert service.list_llm_usages(_context(), provider=OPENAI, model=GPT) == ModelUsageList(
            usages=[
                _usage(apps[0], ModelUsageSource.WORKFLOW_DRAFT, ("llm-1", "LLM", "llm")),
                _usage(apps[1], ModelUsageSource.WORKFLOW_DRAFT, ("llm-1", "LLM", "llm")),
            ],
            inaccessible_count=2,
        )
        assert [request.endpoint for request in transport.requests] == [
            "/rbac/my-permissions",
            "/rbac/apps/whitelist/resources",
        ]

    def test_resolves_no_visibility_when_nothing_matches(
        self,
        service: ModelUsageQueryService,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
    ) -> None:
        transport = self._enable_rbac(monkeypatch, config_overrides, whitelist=[])

        assert service.list_llm_usages(_context(), provider=OPENAI, model=GPT) == ModelUsageList(
            usages=[], inaccessible_count=0
        )
        assert transport.requests == []
