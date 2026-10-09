"""Real conversion, isolated persistence, and failures at the atomic write boundary."""

import json
from collections.abc import Mapping
from typing import cast

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.api_based_extension import APIBasedExtension
from models.model import App, AppMode, AppModelConfig, InstalledApp, Site
from models.workflow import Workflow
from repositories.app.console_repository import ConsoleAppRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.app_entities import AppEvent
from services.errors.workflow_service import WorkflowConversionError
from services.workflow.conversion_service import WorkflowConversionService
from services.workflow.workflow_converter import WorkflowConverter
from tests.unit_tests.model_factories import make_account, make_app, make_tenant

CONTEXT = RequestContext("conversion", None, "account-1", "tenant-1")


@pytest.fixture
def sessions(sqlite_engine: Engine) -> sessionmaker[Session]:
    class ConversionSession(Session):
        pass

    factory = sessionmaker(sqlite_engine, class_=ConversionSession, expire_on_commit=False)
    extension = APIBasedExtension(
        tenant_id="tenant-1", name="Weather", api_endpoint="https://example.com/weather", api_key="encrypted"
    )
    extension.id = "extension-1"
    with factory.begin() as session:
        session.add_all(
            [
                make_account(),
                make_tenant(),
                TenantAccountJoin(
                    tenant_id=CONTEXT.active_workspace_id,
                    account_id=CONTEXT.account_id,
                    role=TenantAccountRole.OWNER,
                    current=True,
                ),
                make_app(name="Source", app_model_config_id="config-1", api_rpm=10, api_rph=100),
                (
                    config := AppModelConfig(
                        app_id="app-1",
                        model=json.dumps(
                            {
                                "provider": "openai",
                                "name": "gpt-4",
                                "mode": "chat",
                                "completion_params": {"stop": ["stop"]},
                            }
                        ),
                        pre_prompt="Hello {{name}}: {{weather}}",
                        user_input_form=json.dumps([{"text-input": {"variable": "name", "label": "Name"}}]),
                        external_data_tools=json.dumps(
                            [
                                {
                                    "enabled": True,
                                    "variable": "weather",
                                    "type": "api",
                                    "config": {"api_based_extension_id": "extension-1"},
                                }
                            ]
                        ),
                        dataset_configs=json.dumps(
                            {
                                "retrieval_model": "multiple",
                                "top_k": 3,
                                "datasets": {"datasets": [{"dataset": {"enabled": True, "id": "dataset-1"}}]},
                            }
                        ),
                        dataset_query_variable="name",
                        opening_statement="Welcome",
                    )
                ),
                extension,
            ]
        )
        config.id = "config-1"
    return cast(sessionmaker[Session], factory)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("agent_enabled", [False, True])
def test_conversion_releases_reads_and_commits_target_once(
    sessions: sessionmaker[Session], mode: AppMode, agent_enabled: bool
) -> None:
    with sessions.begin() as session:
        source = session.get(App, "app-1")
        config = session.get(AppModelConfig, "config-1")
        assert source is not None
        assert config is not None
        source.mode = mode
        config.agent_mode = json.dumps({"enabled": agent_enabled, "strategy": "react"})
        original_config = config.to_dict(annotation_reply={"enabled": False})
    active: set[Session] = set()
    commits = []
    event.listen(sessions.class_, "after_begin", lambda session, *_: active.add(session))

    def end_transaction(session: Session, transaction: SessionTransaction) -> None:
        if transaction.parent is None:
            active.discard(session)

    event.listen(sessions.class_, "after_transaction_end", end_transaction)
    event.listen(sessions.class_, "after_commit", lambda session: commits.append(session))
    notifications = []

    def decrypt(tenant_id: str, token: str) -> str:
        assert not active
        assert (tenant_id, token) == ("tenant-1", "encrypted")
        return "decrypted"

    def created(*, event: AppEvent, account_id: str, backing_agent_id: str | None) -> None:
        assert not active
        assert len(commits) == 1
        assert (account_id, backing_agent_id) == (CONTEXT.account_id, None)
        with sessions() as session:
            assert session.scalar(select(Workflow).where(Workflow.app_id == event.id)) is not None
            assert session.scalar(select(Site).where(Site.app_id == event.id)) is not None
            assert session.scalar(select(InstalledApp).where(InstalledApp.app_id == event.id)) is not None
        notifications.append(event)

    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=decrypt,
        notify_created=created,
    )
    new_id = service.convert(CONTEXT, "app-1", {"name": "", "icon_type": "", "icon": "", "icon_background": ""})
    assert len(notifications) == 1
    assert notifications[0].id == new_id
    with sessions() as session:
        target = session.get(App, new_id)
        source = session.get(App, "app-1")
        config = session.get(AppModelConfig, "config-1")
        assert target is not None
        assert source is not None
        assert config is not None
        assert target.name == "Source(workflow)"
        assert target.mode == (AppMode.WORKFLOW if mode == AppMode.COMPLETION else AppMode.ADVANCED_CHAT)
        assert (target.icon_type, target.icon, target.icon_background) == (
            source.icon_type,
            source.icon,
            source.icon_background,
        )
        assert (target.api_rpm, target.api_rph, target.enable_site, target.enable_api) == (10, 100, True, True)
        assert (target.created_by, target.maintainer, target.updated_by) == (CONTEXT.account_id,) * 3
        assert source.mode == mode
        assert config.to_dict(annotation_reply={"enabled": False}) == original_config
        assert session.scalar(select(Workflow.id).where(Workflow.app_id == source.id)) is None
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == new_id))
        assert workflow is not None
        assert workflow.version == Workflow.VERSION_DRAFT
        nodes = json.loads(workflow.graph)["nodes"]
        assert [node["id"] for node in nodes] == [
            "start",
            "http_request_1",
            "code_1",
            "knowledge_retrieval",
            "llm",
            "end" if mode == AppMode.COMPLETION else "answer",
        ]
        http = nodes[1]["data"]
        assert http["authorization"]["config"]["api_key"] == "decrypted"
        params = json.loads(http["body"]["data"])["params"]
        assert params["app_id"] == source.id
        assert params["query"] == ("{{#sys.query#}}" if mode == AppMode.CHAT else "")
        assert nodes[3]["data"]["query_variable_selector"] == (
            ["sys", "query"] if mode == AppMode.CHAT else ["start", "name"]
        )
        assert "{{#code_1.result#}}" in json.dumps(nodes[4])
        features = json.loads(workflow.features)
        if mode == AppMode.CHAT:
            assert features["opening_statement"] == "Welcome"
            assert "retriever_resource" in features
        else:
            assert set(features) == {"text_to_speech", "file_upload", "sensitive_word_avoidance"}


@pytest.mark.parametrize("failed_record", [InstalledApp, Workflow])
def test_failed_conversion_rolls_back_entire_target(sessions: sessionmaker[Session], failed_record: type) -> None:
    def fail_write(session: Session, *_: object) -> None:
        if any(isinstance(row, failed_record) for row in session.new):
            raise RuntimeError("write failed")

    event.listen(sessions.class_, "before_flush", fail_write)
    notifications = []
    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=lambda *_: "key",
        notify_created=lambda **kwargs: notifications.append(kwargs),
    )
    with pytest.raises(RuntimeError, match="write failed"):
        service.convert(CONTEXT, "app-1", {})
    assert notifications == []
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        for model in (Workflow, Site, InstalledApp):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize(
    "invalid", ["mode", "missing_config", "foreign_config", "foreign_extension", "missing_extension"]
)
def test_conversion_rejects_invalid_owned_data_before_creating_target(
    sessions: sessionmaker[Session], invalid: str
) -> None:
    with sessions.begin() as session:
        source = session.get(App, "app-1")
        config = session.get(AppModelConfig, "config-1")
        extension = session.get(APIBasedExtension, "extension-1")
        assert source is not None
        assert config is not None
        assert extension is not None
        if invalid == "mode":
            source.mode = AppMode.WORKFLOW
        elif invalid == "missing_config":
            source.app_model_config_id = None
        elif invalid == "foreign_config":
            config.app_id = "another-app"
        elif invalid == "foreign_extension":
            extension.tenant_id = "another-tenant"
        else:
            session.delete(extension)
    notifications: list[Mapping[str, object]] = []
    decryptions: list[tuple[object, ...]] = []
    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=lambda *args: decryptions.append(args) or "key",
        notify_created=lambda **kwargs: notifications.append(kwargs),
    )
    with pytest.raises(WorkflowConversionError):
        service.convert(CONTEXT, "app-1", {})
    assert notifications == []
    assert decryptions == []
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        assert session.scalar(select(func.count()).select_from(Workflow)) == 0


def test_conversion_rejects_other_tenant(sessions: sessionmaker[Session]) -> None:
    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=lambda *_: "key",
        notify_created=lambda **_: None,
    )
    with pytest.raises(ConsoleAppNotFoundError):
        service.convert(CONTEXT._replace(active_workspace_id="other-tenant"), "app-1", {})


def test_decryption_failure_creates_no_target(sessions: sessionmaker[Session]) -> None:
    def fail(*_: str) -> str:
        raise RuntimeError("key service unavailable")

    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=fail,
        notify_created=lambda **_: None,
    )
    with pytest.raises(RuntimeError, match="key service unavailable"):
        service.convert(CONTEXT, "app-1", {})
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        assert session.scalar(select(func.count()).select_from(Workflow)) == 0
