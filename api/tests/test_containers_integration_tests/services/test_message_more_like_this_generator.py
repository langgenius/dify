"""Regeneration through real HTTP, worker, persistence, Redis and plugin transport.

Cached provider declarations/credentials/schema are real data, not replacement
methods. Keyword moderation supplies a real successful completion without an
external LLM. Missing installation and credentials exercise actual failures.
"""

import json
import threading
from base64 import b64decode
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from flask.testing import FlaskClient
from sqlalchemy import Connection, delete, event, func, select
from sqlalchemy.orm import Session, SessionTransaction, UOWTransaction
from yarl import URL

from configs import dify_config
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl import base as plugin_base
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.plugin.plugin_service import PluginService
from core.workflow.file_reference import resolve_file_record_id
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from graphon.file.constants import FILE_MODEL_IDENTITY
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from libs.datetime_utils import naive_utc_now
from libs.passport import PassportService
from models.account import Account
from models.enums import ConversationFromSource, CreatorUserRole, CustomizeTokenStrategy, MessageStatus
from models.model import (
    AppMode,
    AppModelConfig,
    Conversation,
    EndUser,
    InstalledApp,
    Message,
    MessageFile,
    Site,
    UploadFile,
)
from models.provider import Provider
from models.tools import ToolFile
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)

_PROVIDER = "tests/regeneration/regeneration"
_MODEL = "completion-model"
_ANSWER = "Moderated response"


@dataclass(frozen=True)
class _Scenario:
    account: Account
    tenant_id: str
    app_id: str
    message_id: str
    historical_config_id: str
    actor_id: str
    actor_role: CreatorUserRole
    url: str
    headers: dict[str, str]
    provider_id: str


@pytest.fixture(params=["web", "explore"])
def scenario(
    request: pytest.FixtureRequest,
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> _Scenario:
    monkeypatch.setattr(dify_config, "PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED", True)
    monkeypatch.setattr(dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", False)
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL(str(dify_config.PLUGIN_DAEMON_URL)))
    session = db_session_with_containers
    account, tenant = create_console_account_and_tenant(session)
    app = create_console_app(session, tenant.id, account.id, AppMode.COMPLETION)
    end_user = EndUser(tenant_id=tenant.id, app_id=app.id, type="browser", session_id=str(uuid4()))
    site = Site(
        app_id=app.id,
        title="Completion",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=str(uuid4()),
    )
    installation = InstalledApp(tenant_id=tenant.id, app_id=app.id, app_owner_tenant_id=tenant.id)
    current = AppModelConfig(app_id=app.id, more_like_this='{"enabled":true}', pre_prompt="Current prompt")
    historical = AppModelConfig(
        app_id=app.id,
        more_like_this='{"enabled":false}',
        model=json.dumps(
            {"provider": _PROVIDER, "name": _MODEL, "mode": "chat", "completion_params": {"temperature": 0.1}}
        ),
        pre_prompt="Historical prompt",
        sensitive_word_avoidance=json.dumps(
            {
                "enabled": True,
                "type": "keywords",
                "config": {
                    "keywords": "Original query",
                    "inputs_config": {"enabled": True, "preset_response": _ANSWER},
                    "outputs_config": {"enabled": False, "preset_response": ""},
                },
            }
        ),
    )
    session.add_all([end_user, site, installation, current, historical])
    session.flush()
    app.app_model_config_id = current.id
    console = request.param == "explore"
    actor_id = account.id if console else end_user.id
    conversation = Conversation(
        app_id=app.id,
        app_model_config_id=historical.id,
        mode=AppMode.COMPLETION,
        name="Original",
        inputs={},
        from_source=ConversationFromSource.CONSOLE if console else ConversationFromSource.API,
        from_account_id=account.id if console else None,
        from_end_user_id=None if console else end_user.id,
    )
    session.add(conversation)
    session.flush()
    message = Message(
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={"count": 0, "empty": "", "items": [], "optional": None},
        query="Original query",
        message={},
        answer="Original answer",
        message_unit_price=0,
        answer_unit_price=0,
        currency="USD",
        from_source=conversation.from_source,
        from_account_id=conversation.from_account_id,
        from_end_user_id=conversation.from_end_user_id,
    )
    provider = Provider(tenant_id=tenant.id, provider_name=_PROVIDER, is_valid=True)
    session.add_all([message, provider])
    session.commit()
    schema = AIModelEntity(
        model=_MODEL,
        label=I18nObject(en_US="Completion"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        parameter_rules=[],
    )
    declaration = PluginModelProviderDeclaration(
        provider=_PROVIDER,
        plugin_unique_identifier="tests/regeneration:0.0.1@" + "0" * 64,
        installation_source=None,
        label=I18nObject(en_US="Regeneration"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[schema],
    )
    PluginService._store_cached_plugin_model_providers(tenant.id, 0, [declaration])
    credentials = {"api_key": "unused-test-key"}
    ProviderCredentialsCache(tenant.id, provider.id, ProviderCredentialsCacheType.PROVIDER).set(credentials)
    redis_client.setex(f"tenant:{tenant.id}:model_load_balancing_enabled", 60, "False")
    runtime = create_plugin_model_runtime(tenant_id=tenant.id)
    redis_client.setex(
        runtime._get_schema_cache_key(
            provider=_PROVIDER, model_type=ModelType.LLM, model=_MODEL, credentials=credentials
        ),
        60,
        schema.model_dump_json(),
    )
    if console:
        headers = authenticate_console_client(test_client_with_containers, account)
        url = f"/console/api/installed-apps/{installation.id}/messages/{message.id}/more-like-this"
    else:
        assert site.code is not None
        headers = {
            HEADER_NAME_APP_CODE: site.code,
            HEADER_NAME_PASSPORT: PassportService().issue(
                {"app_code": site.code, "app_id": app.id, "end_user_id": end_user.id}
            ),
        }
        url = f"/api/messages/{message.id}/more-like-this"
    result = _Scenario(
        account,
        tenant.id,
        app.id,
        message.id,
        historical.id,
        actor_id,
        CreatorUserRole.ACCOUNT if console else CreatorUserRole.END_USER,
        url,
        headers,
        provider.id,
    )
    db.session.remove()
    return result


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("include_parameters", [False, True])
def test_moderated_completion_preserves_history_and_releases_writes_before_worker_reads(
    scenario: _Scenario, test_client_with_containers: FlaskClient, streaming: bool, include_parameters: bool
) -> None:
    with Session(db.engine) as session:
        historical = session.get(AppModelConfig, scenario.historical_config_id)
        assert historical is not None
        model = historical.model_dict
        if not include_parameters:
            model.pop("completion_params")
            historical.model = json.dumps(model)
            session.commit()
        original_model = historical.model
    writes: list[Session] = []
    worker_checks: list[bool] = []
    main_thread = threading.get_ident()
    requests: list[httpx.Request] = []

    def observe_flush(session: Session, _context: UOWTransaction) -> None:
        if any(isinstance(item, Message) and item.app_id == scenario.app_id for item in session.new):
            writes.append(session)

    def observe_query(_session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        if threading.get_ident() != main_thread:
            worker_checks.append(
                bool(writes) and all(not writer.in_transaction() and not writer.identity_map for writer in writes)
            )

    event.listen(Session, "after_flush", observe_flush)
    event.listen(Session, "after_begin", observe_query)
    hooks = plugin_base._httpx_client.event_hooks["request"]
    hooks.append(requests.append)
    try:
        response = test_client_with_containers.get(
            scenario.url,
            query_string={"response_mode": "streaming" if streaming else "blocking"},
            headers=scenario.headers,
        )
        assert response.status_code == HTTPStatus.OK
        if streaming:
            assert response.mimetype == "text/event-stream"
            events = [
                json.loads(line[6:])
                for line in response.get_data(as_text=True).splitlines()
                if line.startswith("data: ")
            ]
            assert "".join(item.get("answer", "") for item in events if item["event"] == "message") == _ANSWER
            assert events[-1]["event"] == "message_end"
            message_id = events[-1]["message_id"]
        else:
            payload = response.get_json()
            assert isinstance(payload, dict)
            assert payload["answer"] == _ANSWER
            message_id = payload["message_id"]
        response.close()
    finally:
        hooks.remove(requests.append)
        event.remove(Session, "after_flush", observe_flush)
        event.remove(Session, "after_begin", observe_query)
    assert not requests
    assert worker_checks
    assert all(worker_checks)
    assert len(writes) == 1
    with Session(db.engine) as session:
        regenerated = session.get(Message, message_id)
        original = session.get(Message, scenario.message_id)
        historical = session.get(AppModelConfig, scenario.historical_config_id)
        assert regenerated is not None
        assert original is not None
        assert historical is not None
        assert regenerated.id != original.id
        assert regenerated.conversation_id != original.conversation_id
        assert regenerated.query == original.query
        assert regenerated._inputs == {"count": 0, "empty": "", "items": [], "optional": None}
        assert regenerated.from_account_id == original.from_account_id
        assert regenerated.from_end_user_id == original.from_end_user_id
        assert regenerated.answer == _ANSWER
        assert regenerated.override_model_configs is not None
        config = json.loads(regenerated.override_model_configs)
        assert config["pre_prompt"] == "Historical prompt"
        assert config["model"]["completion_params"] == {"temperature": 0.9}
        assert historical.model == original_model
        assert session.scalar(select(func.count()).select_from(Message)) == 2
        installation = session.scalar(select(InstalledApp).where(InstalledApp.app_id == scenario.app_id))
        assert installation is not None
        assert installation.last_used_at is None


@pytest.mark.parametrize("transfer_method", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE])
def test_moderated_completion_rebuilds_files_and_inputs_without_rewriting_history(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
    transfer_method: FileTransferMethod,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dify_config, "MULTIMODAL_SEND_FORMAT", "base64")
    backend = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr(storage, "storage_runner", backend)
    image = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xU5sAAAAASUVORK5CYII=")
    backend.save("stored/image.png", image)
    with Session(db.engine) as session:
        config = session.get(AppModelConfig, scenario.historical_config_id)
        original = session.get(Message, scenario.message_id)
        assert config is not None
        assert original is not None
        config.file_upload = json.dumps(
            {
                "enabled": True,
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["local_file", "tool_file"],
                "number_limits": 2,
            }
        )
        if transfer_method == FileTransferMethod.LOCAL_FILE:
            file = UploadFile(
                tenant_id=scenario.tenant_id,
                storage_type=StorageType.LOCAL,
                key="stored/image.png",
                name="image.png",
                size=len(image),
                extension="png",
                mime_type="image/png",
                created_by_role=scenario.actor_role,
                created_by=scenario.actor_id,
                created_at=naive_utc_now(),
                used=True,
            )
        else:
            file = ToolFile(
                user_id=scenario.actor_id,
                tenant_id=scenario.tenant_id,
                conversation_id=None,
                file_key="stored/image.png",
                mimetype="image/png",
                original_url="https://example.com/image.png",
                name="image.png",
                size=len(image),
            )
        session.add(file)
        session.flush()
        record_id = file.id
        attachment = MessageFile(
            message_id=original.id,
            type=FileType.IMAGE,
            transfer_method=transfer_method,
            url=f"https://example.com/tools/{record_id}.png"
            if transfer_method == FileTransferMethod.TOOL_FILE
            else None,
            upload_file_id=record_id if transfer_method == FileTransferMethod.LOCAL_FILE else None,
            created_by_role=scenario.actor_role,
            created_by=scenario.actor_id,
        )
        session.add(attachment)
        stored_input = {
            "dify_model_identity": FILE_MODEL_IDENTITY,
            "type": "image",
            "transfer_method": transfer_method,
            "related_id": record_id,
            "tenant_id": str(uuid4()),
            "filename": "untrusted.png",
        }
        original.inputs = {"file": stored_input}
        session.commit()
        attachment_id = attachment.id
    response = test_client_with_containers.get(
        scenario.url, query_string={"response_mode": "blocking"}, headers=scenario.headers
    )
    assert response.status_code == HTTPStatus.OK
    payload = response.get_json()
    assert isinstance(payload, dict)
    assert payload["answer"] == _ANSWER
    with Session(db.engine) as session:
        generated = session.get(Message, payload["message_id"])
        original = session.get(Message, scenario.message_id)
        saved_attachment = session.get(MessageFile, attachment_id)
        new_attachment = session.scalar(select(MessageFile).where(MessageFile.message_id == payload["message_id"]))
        assert generated is not None
        assert original is not None
        assert saved_attachment is not None
        assert new_attachment is not None
        assert generated._inputs["file"]["filename"] == "image.png"
        assert resolve_file_record_id(generated._inputs["file"]["reference"]) == record_id
        assert original._inputs == {"file": stored_input}
        assert new_attachment.upload_file_id == record_id
        assert new_attachment.created_by == scenario.actor_id
        assert saved_attachment.upload_file_id == (
            record_id if transfer_method == FileTransferMethod.LOCAL_FILE else None
        )


def test_real_missing_credentials_returns_http_error_without_creating_records(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
) -> None:
    with Session(db.engine) as session:
        session.execute(delete(Provider).where(Provider.id == scenario.provider_id))
        session.commit()
    response = test_client_with_containers.get(
        scenario.url, query_string={"response_mode": "blocking"}, headers=scenario.headers
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    payload = response.get_json()
    assert isinstance(payload, dict)
    assert payload["code"] == "provider_not_initialize"
    with Session(db.engine) as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("failure", ["missing_plugin", "invalid_transport"])
def test_real_provider_failure_persists_worker_error_and_preserves_http_or_sse_contract(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
    streaming: bool,
    failure: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if failure == "invalid_transport":
        monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL("unsupported://plugin-daemon"))
    # PluginModelClient converts both missing-plugin (-404) and transport (-500)
    # PluginDaemonInnerError failures to ValueError, yielding invalid_param.
    expected_error = "-404" if failure == "missing_plugin" else "Request to Plugin Daemon Service failed-500"
    with Session(db.engine) as session:
        config = session.get(AppModelConfig, scenario.historical_config_id)
        assert config is not None
        config.sensitive_word_avoidance = '{"enabled":false}'
        session.commit()
    requests: list[httpx.Request] = []
    source_sessions: list[Session] = []
    active_source_sessions: list[Session] = []
    main_thread = threading.get_ident()

    def observe_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        if threading.get_ident() == main_thread:
            source_sessions.append(session)

    def observe_request(request: httpx.Request) -> None:
        requests.append(request)
        active_source_sessions.extend(session for session in source_sessions if session.in_transaction())

    event.listen(Session, "after_begin", observe_session)
    hooks = plugin_base._httpx_client.event_hooks["request"]
    hooks.append(observe_request)
    try:
        response = test_client_with_containers.get(
            scenario.url,
            query_string={"response_mode": "streaming" if streaming else "blocking"},
            headers=scenario.headers,
        )
        if streaming:
            assert response.status_code == HTTPStatus.OK
            assert response.mimetype == "text/event-stream"
            events = [
                json.loads(line[6:])
                for line in response.get_data(as_text=True).splitlines()
                if line.startswith("data: ")
            ]
            errors = [item for item in events if item["event"] == "error"]
            assert len(errors) == 1
            assert errors[0]["code"] == "invalid_param"
            assert expected_error in errors[0]["message"]
            assert errors[0]["status"] == HTTPStatus.BAD_REQUEST
        else:
            assert response.status_code == HTTPStatus.BAD_REQUEST
            payload = response.get_json()
            assert isinstance(payload, dict)
            assert payload["code"] == "invalid_param"
            assert expected_error in payload["message"]
        response.close()
    finally:
        hooks.remove(observe_request)
        event.remove(Session, "after_begin", observe_session)
    assert source_sessions
    assert not active_source_sessions
    assert any(request.url.path == f"/plugin/{scenario.tenant_id}/dispatch/llm/invoke" for request in requests)
    with Session(db.engine) as session:
        generated = session.scalars(select(Message).where(Message.id != scenario.message_id)).one()
        assert generated.status == MessageStatus.ERROR
        assert generated.error is not None
        assert expected_error in generated.error
        original = session.get(Message, scenario.message_id)
        assert original is not None
        assert original.answer == "Original answer"
