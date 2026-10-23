from __future__ import annotations

import builtins
import json
import queue
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import UUID, uuid4

import pytest
from Crypto.PublicKey import RSA
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import core.ops.ops_trace_manager as module
import models.engine as model_engine
from core.moderation.base import ModerationAction, ModerationInputsResult
from core.ops.base_trace_instance import bind_application_tracing_hooks
from core.ops.exceptions import TraceProviderNotInstalledError
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager, TraceTask, TraceTaskName
from core.rag.models.document import Document as RetrievalDocument
from core.tools.entities.tool_entities import ApiProviderSchemaType
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.model_entities import ModelType
from libs import gmpy2_pkcs10aep_cipher, rsa
from libs.key_providers.rsa_key_provider import RSAKeyProvider
from models.account import Tenant
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import (
    App,
    AppMode,
    AppModelConfig,
    Conversation,
    IconType,
    Message,
    MessageAgentThought,
    MessageFile,
    TraceAppConfig,
)
from models.provider import Provider, ProviderCredential, ProviderModel, ProviderModelCredential, ProviderType
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app, make_tenant

"""Unit tests for lookup helper functions in core.ops.ops_trace_manager.

Covers:
- _lookup_app_and_workspace_names
- _lookup_credential_name
- _lookup_llm_credential_info
- TraceTask._get_user_id_from_metadata
"""


def _persist_app(session: Session, *, tenant_id: str, name: str = "MyApp") -> App:
    app = App(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name=name,
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="workflow",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


def _persist_tenant(session: Session, *, name: str = "MyWorkspace") -> Tenant:
    tenant = Tenant(name=name)
    session.add(tenant)
    session.commit()
    return tenant


def _persist_tool_provider(
    session: Session, provider_type: str
) -> BuiltinToolProvider | ApiToolProvider | WorkflowToolProvider | MCPToolProvider:
    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    if provider_type in {"builtin", "plugin"}:
        provider = BuiltinToolProvider(
            name="CredentialA",
            tenant_id=tenant_id,
            user_id=user_id,
            provider="test/provider",
        )
    elif provider_type == "api":
        provider = ApiToolProvider(
            name="CredentialA",
            icon="icon.svg",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id=user_id,
            tenant_id=tenant_id,
            description="API provider",
            tools_str="[]",
            credentials_str="{}",
        )
    elif provider_type == "workflow":
        provider = WorkflowToolProvider(
            name="CredentialA",
            label="CredentialA",
            icon="icon.svg",
            app_id=str(uuid.uuid4()),
            version="1",
            user_id=user_id,
            tenant_id=tenant_id,
            description="Workflow provider",
        )
    elif provider_type == "mcp":
        provider = MCPToolProvider(
            name="CredentialA",
            server_identifier="credential-a",
            server_url="https://example.com/mcp",
            server_url_hash="credential-a-hash",
            icon="icon.svg",
            tenant_id=tenant_id,
            user_id=user_id,
        )
    else:
        raise ValueError(f"unsupported provider type: {provider_type}")

    session.add(provider)
    session.commit()
    return provider


def _persist_provider_credential(
    session: Session,
    *,
    tenant_id: str,
    credential_name: str = "ProvCredName",
) -> ProviderCredential:
    credential = ProviderCredential(
        tenant_id=tenant_id,
        provider_name="openai",
        credential_name=credential_name,
        encrypted_config="{}",
    )
    session.add(credential)
    session.commit()
    return credential


def _persist_model_credential(
    session: Session,
    *,
    tenant_id: str,
    credential_name: str = "ModelCredName",
) -> ProviderModelCredential:
    credential = ProviderModelCredential(
        tenant_id=tenant_id,
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name=credential_name,
        encrypted_config="{}",
    )
    session.add(credential)
    session.commit()
    return credential


def _persist_provider(
    session: Session,
    *,
    tenant_id: str,
    credential_id: str | None,
) -> Provider:
    provider = Provider(
        tenant_id=tenant_id,
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        credential_id=credential_id,
    )
    session.add(provider)
    session.commit()
    return provider


def _persist_provider_model(
    session: Session,
    *,
    tenant_id: str,
    credential_id: str | None,
) -> ProviderModel:
    model = ProviderModel(
        tenant_id=tenant_id,
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_id=credential_id,
    )
    session.add(model)
    session.commit()
    return model


@contextmanager
def _raise_on_table(engine: Engine, table_name: str) -> Iterator[None]:
    """Raise only when SQL targets the named table, leaving other real lookups intact."""

    def fail_target_query(_conn, _cursor, statement, _parameters, _context, _executemany):
        if f"FROM {table_name}" in statement:
            raise RuntimeError(f"forced failure for {table_name}")

    event.listen(engine, "before_cursor_execute", fail_target_query)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", fail_target_query)


class TestLookupHelpersCases:
    # ---------------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------------

    @staticmethod
    @pytest.fixture
    def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
        models = (
            App,
            Tenant,
            Provider,
            ProviderCredential,
            ProviderModel,
            ProviderModelCredential,
            BuiltinToolProvider,
            ApiToolProvider,
            WorkflowToolProvider,
            MCPToolProvider,
        )
        tables = [model.metadata.tables[model.__tablename__] for model in models]
        TypeBase.metadata.create_all(sqlite_engine, tables=tables)

        with patch.object(type(db), "engine", new_callable=PropertyMock, return_value=sqlite_engine):
            with Session(sqlite_engine, expire_on_commit=False) as session:
                yield session

    # ---------------------------------------------------------------------------
    # _lookup_app_and_workspace_names
    # ---------------------------------------------------------------------------

    class TestLookupAppAndWorkspaceNames:
        """Tests for _lookup_app_and_workspace_names(app_id, tenant_id)."""

        def test_both_found(self, orm_session: Session):
            """Returns (app_name, workspace_name) when both records exist."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            tenant = _persist_tenant(orm_session)
            app = _persist_app(orm_session, tenant_id=tenant.id)
            app_name, workspace_name = _lookup_app_and_workspace_names(app.id, tenant.id)

            assert app_name == "MyApp"
            assert workspace_name == "MyWorkspace"

        def test_app_only_found(self, orm_session: Session):
            """Returns (app_name, '') when tenant record is absent."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            app = _persist_app(orm_session, tenant_id=str(uuid.uuid4()))
            app_name, workspace_name = _lookup_app_and_workspace_names(app.id, str(uuid.uuid4()))

            assert app_name == "MyApp"
            assert workspace_name == ""

        def test_tenant_only_found(self, orm_session: Session):
            """Returns ('', workspace_name) when app record is absent."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            tenant = _persist_tenant(orm_session)
            app_name, workspace_name = _lookup_app_and_workspace_names(str(uuid.uuid4()), tenant.id)

            assert app_name == ""
            assert workspace_name == "MyWorkspace"

        def test_neither_found(self, orm_session: Session):
            """Returns ('', '') when both DB lookups return None."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            app_name, workspace_name = _lookup_app_and_workspace_names(str(uuid.uuid4()), str(uuid.uuid4()))

            assert app_name == ""
            assert workspace_name == ""

        def test_none_inputs_skips_db(self):
            """Returns ('', '') immediately when both IDs are None — no DB access."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            app_name, workspace_name = _lookup_app_and_workspace_names(None, None)

            assert app_name == ""
            assert workspace_name == ""

        def test_app_id_none_only_queries_tenant(self, orm_session: Session):
            """When app_id is None, only the tenant query is issued."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            tenant = _persist_tenant(orm_session, name="OnlyWorkspace")
            app_name, workspace_name = _lookup_app_and_workspace_names(None, tenant.id)

            assert app_name == ""
            assert workspace_name == "OnlyWorkspace"

        def test_tenant_id_none_only_queries_app(self, orm_session: Session):
            """When tenant_id is None, only the app query is issued."""
            from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

            app = _persist_app(orm_session, tenant_id=str(uuid.uuid4()), name="OnlyApp")
            app_name, workspace_name = _lookup_app_and_workspace_names(app.id, None)

            assert app_name == "OnlyApp"
            assert workspace_name == ""

    # ---------------------------------------------------------------------------
    # _lookup_credential_name
    # ---------------------------------------------------------------------------

    class TestLookupCredentialName:
        """Tests for _lookup_credential_name(credential_id, provider_type)."""

        @pytest.mark.parametrize("provider_type", ["builtin", "plugin", "api", "workflow", "mcp"])
        def test_known_provider_types_return_name(self, provider_type: str, orm_session: Session):
            """Each valid provider_type results in a DB query and returns the credential name."""
            from core.ops.ops_trace_manager import _lookup_credential_name

            provider = _persist_tool_provider(orm_session, provider_type)
            result = _lookup_credential_name(provider.id, provider_type)

            assert result == "CredentialA"

        def test_credential_not_found_returns_empty_string(self, orm_session: Session):
            """Returns '' when DB yields None for the given credential_id."""
            from core.ops.ops_trace_manager import _lookup_credential_name

            result = _lookup_credential_name(str(uuid.uuid4()), "api")

            assert result == ""

        def test_invalid_provider_type_returns_empty_string_without_db(self):
            """Returns '' immediately for an unrecognised provider_type — no DB access."""
            from core.ops.ops_trace_manager import _lookup_credential_name

            result = _lookup_credential_name(str(uuid.uuid4()), "unknown_type")

            assert result == ""

        def test_none_credential_id_returns_empty_string_without_db(self):
            """Returns '' immediately when credential_id is None — no DB access."""
            from core.ops.ops_trace_manager import _lookup_credential_name

            result = _lookup_credential_name(None, "api")

            assert result == ""

        def test_none_provider_type_returns_empty_string_without_db(self):
            """Returns '' immediately when provider_type is None — no DB access."""
            from core.ops.ops_trace_manager import _lookup_credential_name

            result = _lookup_credential_name(str(uuid.uuid4()), None)

            assert result == ""

        def test_builtin_and_plugin_map_to_same_model(self):
            """Both 'builtin' and 'plugin' provider_types query BuiltinToolProvider."""
            from core.ops.ops_trace_manager import _PROVIDER_TYPE_TO_MODEL
            from models.tools import BuiltinToolProvider

            assert _PROVIDER_TYPE_TO_MODEL["builtin"] is BuiltinToolProvider
            assert _PROVIDER_TYPE_TO_MODEL["plugin"] is BuiltinToolProvider

        def test_api_maps_to_api_tool_provider(self):
            """'api' maps to ApiToolProvider."""
            from core.ops.ops_trace_manager import _PROVIDER_TYPE_TO_MODEL
            from models.tools import ApiToolProvider

            assert _PROVIDER_TYPE_TO_MODEL["api"] is ApiToolProvider

        def test_workflow_maps_to_workflow_tool_provider(self):
            """'workflow' maps to WorkflowToolProvider."""
            from core.ops.ops_trace_manager import _PROVIDER_TYPE_TO_MODEL
            from models.tools import WorkflowToolProvider

            assert _PROVIDER_TYPE_TO_MODEL["workflow"] is WorkflowToolProvider

        def test_mcp_maps_to_mcp_tool_provider(self):
            """'mcp' maps to MCPToolProvider."""
            from core.ops.ops_trace_manager import _PROVIDER_TYPE_TO_MODEL
            from models.tools import MCPToolProvider

            assert _PROVIDER_TYPE_TO_MODEL["mcp"] is MCPToolProvider

    # ---------------------------------------------------------------------------
    # _lookup_llm_credential_info
    # ---------------------------------------------------------------------------

    class TestLookupLlmCredentialInfo:
        """Tests for _lookup_llm_credential_info(tenant_id, provider, model, model_type)."""

        def test_model_level_credential_found(self, orm_session: Session):
            """Returns model-level credential_id and name when ProviderModel has a credential."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            model_credential = _persist_model_credential(orm_session, tenant_id=tenant_id)
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=None)
            _persist_provider_model(orm_session, tenant_id=tenant_id, credential_id=model_credential.id)

            decoy_tenant_id = str(uuid.uuid4())
            decoy_credential = _persist_model_credential(
                orm_session,
                tenant_id=decoy_tenant_id,
                credential_name="WrongTenantCredential",
            )
            _persist_provider(orm_session, tenant_id=decoy_tenant_id, credential_id=None)
            _persist_provider_model(orm_session, tenant_id=decoy_tenant_id, credential_id=decoy_credential.id)

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id == model_credential.id
            assert cred_name == "ModelCredName"

        def test_provider_level_fallback_when_no_model_credential(self, orm_session: Session):
            """Falls back to provider-level credential when ProviderModel has no credential_id."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            provider_credential = _persist_provider_credential(orm_session, tenant_id=tenant_id)
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=provider_credential.id)
            _persist_provider_model(orm_session, tenant_id=tenant_id, credential_id=None)

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id == provider_credential.id
            assert cred_name == "ProvCredName"

        def test_provider_level_fallback_when_no_model_record(self, orm_session: Session):
            """Falls back to provider-level credential when no ProviderModel row exists."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            provider_credential = _persist_provider_credential(orm_session, tenant_id=tenant_id)
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=provider_credential.id)

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id == provider_credential.id
            assert cred_name == "ProvCredName"

        def test_no_model_arg_uses_provider_level_only(self, orm_session: Session):
            """When model is None, skips ProviderModel query and uses provider credential."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            provider_credential = _persist_provider_credential(orm_session, tenant_id=tenant_id)
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=provider_credential.id)

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", None)

            assert cred_id == provider_credential.id
            assert cred_name == "ProvCredName"

        def test_provider_not_found_returns_none_and_empty(self, orm_session: Session):
            """Returns (None, '') when Provider record does not exist."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            other_tenant_id = str(uuid.uuid4())
            _persist_provider(orm_session, tenant_id=other_tenant_id, credential_id=None)
            tenant_id = str(uuid.uuid4())

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id is None
            assert cred_name == ""

        def test_none_tenant_id_returns_none_and_empty_without_db(self):
            """Returns (None, '') immediately when tenant_id is None — no DB access."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            cred_id, cred_name = _lookup_llm_credential_info(None, "openai", "gpt-4")

            assert cred_id is None
            assert cred_name == ""

        def test_none_provider_returns_none_and_empty_without_db(self):
            """Returns (None, '') immediately when provider is None — no DB access."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            cred_id, cred_name = _lookup_llm_credential_info(str(uuid.uuid4()), None, "gpt-4")

            assert cred_id is None
            assert cred_name == ""

        def test_db_error_on_outer_query_returns_none_and_empty(self, orm_session: Session, sqlite_engine: Engine):
            """Returns (None, '') and logs a warning when the outer DB query raises."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            with _raise_on_table(sqlite_engine, "providers"):
                cred_id, cred_name = _lookup_llm_credential_info(str(uuid.uuid4()), "openai", "gpt-4")

            assert cred_id is None
            assert cred_name == ""

        def test_credential_name_lookup_failure_returns_id_with_empty_name(
            self, orm_session: Session, sqlite_engine: Engine
        ):
            """When credential name sub-query fails, returns cred_id but '' for name."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            provider_credential = _persist_provider_credential(orm_session, tenant_id=tenant_id)
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=provider_credential.id)

            with _raise_on_table(sqlite_engine, "provider_credentials"):
                cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id == provider_credential.id
            assert cred_name == ""

        def test_no_credential_on_provider_or_model_returns_none_id(self, orm_session: Session):
            """Returns (None, '') when neither provider nor model has a credential_id."""
            from core.ops.ops_trace_manager import _lookup_llm_credential_info

            tenant_id = str(uuid.uuid4())
            _persist_provider(orm_session, tenant_id=tenant_id, credential_id=None)
            _persist_provider_model(orm_session, tenant_id=tenant_id, credential_id=None)

            cred_id, cred_name = _lookup_llm_credential_info(tenant_id, "openai", "gpt-4")

            assert cred_id is None
            assert cred_name == ""

    # ---------------------------------------------------------------------------
    # TraceTask._get_user_id_from_metadata
    # ---------------------------------------------------------------------------

    class TestGetUserIdFromMetadata:
        """Tests for TraceTask._get_user_id_from_metadata(metadata).

        Pure dict logic — no DB access required.
        """

        @pytest.fixture
        def get_user_id(self):
            """Return the classmethod under test."""
            from core.ops.ops_trace_manager import TraceTask

            return TraceTask._get_user_id_from_metadata

        def test_from_end_user_id_has_highest_priority(self, get_user_id):
            """from_end_user_id takes precedence over all other keys."""
            metadata = {
                "from_end_user_id": "eu-abc",
                "from_account_id": "acc-xyz",
                "user_id": "u-123",
            }
            assert get_user_id(metadata) == "end_user:eu-abc"

        def test_from_account_id_used_when_no_end_user(self, get_user_id):
            """from_account_id is used when from_end_user_id is absent."""
            metadata = {
                "from_account_id": "acc-xyz",
                "user_id": "u-123",
            }
            assert get_user_id(metadata) == "account:acc-xyz"

        def test_user_id_used_when_no_end_user_or_account(self, get_user_id):
            """user_id is used when both higher-priority keys are absent."""
            metadata = {"user_id": "u-123"}
            assert get_user_id(metadata) == "user:u-123"

        def test_returns_anonymous_when_all_keys_absent(self, get_user_id):
            """Returns 'anonymous' when metadata has none of the expected keys."""
            assert get_user_id({}) == "anonymous"

        def test_empty_string_end_user_id_is_skipped(self, get_user_id):
            """Empty string for from_end_user_id is falsy and falls through to next key."""
            metadata = {
                "from_end_user_id": "",
                "from_account_id": "acc-xyz",
            }
            assert get_user_id(metadata) == "account:acc-xyz"

        def test_empty_string_account_id_is_skipped(self, get_user_id):
            """Empty string for from_account_id is falsy and falls through to user_id."""
            metadata = {
                "from_end_user_id": "",
                "from_account_id": "",
                "user_id": "u-123",
            }
            assert get_user_id(metadata) == "user:u-123"

        def test_empty_string_user_id_falls_through_to_anonymous(self, get_user_id):
            """Empty string for user_id is falsy, so 'anonymous' is returned."""
            metadata = {
                "from_end_user_id": "",
                "from_account_id": "",
                "user_id": "",
            }
            assert get_user_id(metadata) == "anonymous"

        def test_only_from_end_user_id_present(self, get_user_id):
            """Minimal case: only from_end_user_id present."""
            assert get_user_id({"from_end_user_id": "eu-only"}) == "end_user:eu-only"

        def test_irrelevant_keys_do_not_interfere(self, get_user_id):
            """Extra metadata keys have no effect on the result."""
            metadata = {"invoke_from": "web", "app_id": "a1"}
            assert get_user_id(metadata) == "anonymous"


"""SQLite-backed tests for :mod:`core.ops.ops_trace_manager`."""


class DummyConfig:
    def __init__(self, **kwargs):
        self._data = kwargs

    def model_dump(self):
        return dict(self._data)


class DummyTraceInstance:
    def __init__(self, config):
        self.config = config

    def api_check(self):
        return True

    def get_project_key(self):
        return "fake-key"

    def get_project_url(self):
        return "https://project.fake"


class DummyUnifiedTraceInstance(DummyTraceInstance):
    pass


class FailingUnifiedTraceInstance(DummyTraceInstance):
    def __init__(self, config):
        raise RuntimeError("unified constructor failed")


class FakeProviderMap:
    def __init__(self, data):
        self._data = data

    def __getitem__(self, key):
        if key in self._data:
            return self._data[key]
        raise KeyError(key)


PROVIDER_ENTRY = {
    "config_class": DummyConfig,
    "secret_keys": ["secret_value"],
    "other_keys": ["other_value"],
    "trace_instance": DummyTraceInstance,
}

UNIFIED_PROVIDER_ENTRY = {
    "config_class": DummyConfig,
    "trace_instance": DummyUnifiedTraceInstance,
}


class DummyTimer:
    def __init__(self, interval, function):
        self.interval = interval
        self.function = function
        self.name = ""
        self.daemon = False
        self.started = False

    def start(self):
        self.started = True

    def is_alive(self):
        return False


class EncryptTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, tenant_id: str, value: str) -> str:
        self.calls.append((tenant_id, value))
        return f"enc-{value}"


class BatchDecryptTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def __call__(self, tenant_id: str, values: list[str]) -> list[str]:
        self.calls.append((tenant_id, values))
        return [f"dec-{value}" for value in values]


class ObfuscatedTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, value: str) -> str:
        self.calls.append(value)
        return f"ob-{value}"


class RecordingStorage:
    def __init__(self) -> None:
        self.writes: list[tuple[str, bytes]] = []

    def save(self, path: str, data: bytes) -> None:
        self.writes.append((path, data))


class RecordingDispatcher:
    def __init__(self) -> None:
        self.payloads: list[dict[str, str]] = []
        self.options: list[dict[str, object]] = []

    def apply_async(self, *, args: list[dict[str, str]], **kwargs: object) -> None:
        self.payloads.append(args[0])
        self.options.append(kwargs)


def _app(session: Session, *, app_id: str = "app-id", tracing: str | None = None) -> App:
    app = make_app(app_id=app_id, name="App", description="description", icon_type=None, tracing=tracing)
    session.add(app)
    session.commit()
    return app


def _conversation_message(
    session: Session, app: App, *, config: AppModelConfig | None = None
) -> tuple[Conversation, Message]:
    conversation = Conversation(
        id="conversation-1",
        app_id=app.id,
        app_model_config_id=config.id if config else None,
        model_provider="provider",
        override_model_configs=None,
        model_id="model",
        mode=AppMode.CHAT,
        name="Conversation",
        summary="",
        _inputs={},
        introduction="",
        system_instruction="",
        invoke_from=None,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id="end-user-1",
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    message = Message(
        id="message-1",
        app_id=app.id,
        model_provider="provider",
        model_id="model",
        override_model_configs=None,
        conversation_id=conversation.id,
        _inputs={},
        query="query",
        message={"text": "hello"},
        message_tokens=5,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal("0.001"),
        answer="world",
        answer_tokens=7,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=1,
        total_price=Decimal(0),
        currency="USD",
        status=MessageStatus.NORMAL,
        error=None,
        message_metadata=None,
        invoke_from=None,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id="end-user-1",
        from_account_id=None,
        agent_based=False,
        workflow_run_id="run-1",
        app_mode=AppMode.CHAT,
    )
    session.add_all([conversation, message])
    session.commit()
    return conversation, message


def _message_data(**overrides):
    created_at = datetime(2025, 2, 20, 12, 0, 0)
    data = {
        "id": "message-1",
        "app_id": "app-id",
        "conversation_id": "conversation-1",
        "created_at": created_at,
        "updated_at": created_at + timedelta(seconds=3),
        "message": "hello",
        "provider_response_latency": 1,
        "message_tokens": 5,
        "answer_tokens": 7,
        "answer": "world",
        "error": "",
        "status": "complete",
        "model_provider": "provider",
        "model_id": "model",
        "from_end_user_id": "end-user-1",
        "from_account_id": None,
        "agent_based": False,
        "workflow_run_id": "run-1",
        "from_source": "console",
        "message_metadata": json.dumps({"usage": {"time_to_first_token": 1, "time_to_generate": 2}}),
        "agent_thoughts": [],
        "query": "query",
        "inputs": "inputs",
    }
    data.update(overrides)
    return SimpleNamespace(
        **data,
        agent_thoughts_with_session=lambda *, session: data["agent_thoughts"],
        to_dict=lambda: data,
    )


class TestOpsTraceManagerCases:
    @staticmethod
    @pytest.fixture
    def database(sqlite_engine: Engine, sqlite_session: Session) -> Iterator[Session]:
        session_proxy = scoped_session(lambda: sqlite_session)
        with (
            patch.object(module.db, "session", session_proxy),
            patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=sqlite_engine),
        ):
            yield sqlite_session

    @staticmethod
    @pytest.fixture
    def trace_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
        monkeypatch.setattr(module, "provider_config_map", FakeProviderMap({"dummy": PROVIDER_ENTRY}))
        monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap({}))
        apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=False)
        OpsTraceManager.ops_trace_instances_cache.clear()
        OpsTraceManager.decrypted_configs_cache.clear()
        monkeypatch.setattr(module.threading, "Timer", DummyTimer)
        monkeypatch.setattr(module, "trace_manager_queue", queue.Queue())
        monkeypatch.setattr(module, "trace_manager_timer", None)
        monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

        app = Flask(__name__)
        with app.app_context():
            yield

    @staticmethod
    @pytest.fixture
    def encryption_functions(
        monkeypatch: pytest.MonkeyPatch,
    ) -> tuple[EncryptTokenRecorder, BatchDecryptTokenRecorder, ObfuscatedTokenRecorder]:
        encrypt = EncryptTokenRecorder()
        decrypt = BatchDecryptTokenRecorder()
        obfuscate = ObfuscatedTokenRecorder()
        monkeypatch.setattr(module, "encrypt_token", encrypt)
        monkeypatch.setattr(module, "batch_decrypt_token", decrypt)
        monkeypatch.setattr(module, "obfuscated_token", obfuscate)
        return encrypt, decrypt, obfuscate

    @staticmethod
    def test_encrypt_decrypt_obfuscate_and_cache(
        trace_environment: None,
        encryption_functions: tuple[EncryptTokenRecorder, BatchDecryptTokenRecorder, ObfuscatedTokenRecorder],
    ) -> None:
        encrypted = OpsTraceManager.encrypt_tracing_config(
            "tenant-1", "dummy", {"secret_value": "value", "other_value": "info"}
        )
        assert encrypted == {"secret_value": "enc-value", "other_value": "info"}
        preserved = OpsTraceManager.encrypt_tracing_config(
            "tenant-1", "dummy", {"secret_value": "*"}, current_trace_config={"secret_value": "keep"}
        )
        assert preserved["secret_value"] == "keep"
        first = OpsTraceManager.decrypt_tracing_config("tenant-1", "dummy", encrypted)
        second = OpsTraceManager.decrypt_tracing_config("tenant-1", "dummy", encrypted)
        assert first == second
        assert len(encryption_functions[1].calls) == 1
        obfuscated = OpsTraceManager.obfuscated_decrypt_token("dummy", first)
        assert obfuscated["secret_value"] == "ob-dec-enc-value"
        assert encryption_functions[2].calls == ["dec-enc-value"]

    @staticmethod
    def test_decrypted_config_reads_real_trace_and_app_rows(
        trace_environment: None,
        encryption_functions,
        database: Session,
    ) -> None:
        app = _app(database)
        trace = TraceAppConfig(
            app_id=app.id,
            tracing_provider="dummy",
            tracing_config={"secret_value": "encrypted", "other_value": "info"},
        )
        database.add(trace)
        database.commit()
        result = OpsTraceManager.get_decrypted_tracing_config(app.id, "dummy")
        assert result == {"secret_value": "dec-encrypted", "other_value": "info"}
        assert OpsTraceManager.get_decrypted_tracing_config(app.id, "missing") is None

        null_config_app = _app(database, app_id="app-null-config")
        database.add(TraceAppConfig(app_id=null_config_app.id, tracing_provider="dummy", tracing_config=None))
        database.commit()
        with pytest.raises(ValueError, match="Tracing config cannot be None"):
            OpsTraceManager.get_decrypted_tracing_config(null_config_app.id, "dummy")

        database.delete(app)
        database.commit()
        with pytest.raises(ValueError, match="App not found"):
            OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")

    @staticmethod
    def test_ops_trace_instance_uses_persisted_enabled_state_and_cache(
        trace_environment: None,
        encryption_functions,
        database: Session,
    ) -> None:
        app = _app(database, tracing=json.dumps({"enabled": False, "tracing_provider": "dummy"}))
        assert OpsTraceManager.get_ops_trace_instance(app.id) is None
        app.tracing = json.dumps({"enabled": True, "tracing_provider": "dummy"})
        database.add(
            TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={"secret_value": "encrypted"})
        )
        database.commit()
        instance = OpsTraceManager.get_ops_trace_instance(app.id)
        assert isinstance(instance, DummyTraceInstance)
        assert OpsTraceManager.get_ops_trace_instance(app.id) is instance

        app.tracing = json.dumps({"enabled": True, "tracing_provider": "missing"})
        database.commit()
        assert OpsTraceManager.get_ops_trace_instance(app.id) is None

        assert OpsTraceManager.get_ops_trace_instance(None) is None
        assert OpsTraceManager.get_ops_trace_instance("tenant-storage-id") is None
        assert OpsTraceManager.get_ops_trace_instance("missing") is None

    @staticmethod
    @pytest.mark.parametrize(
        ("enabled", "registered", "expected_type"),
        [
            (False, False, DummyTraceInstance),
            (False, True, DummyTraceInstance),
            (True, False, DummyTraceInstance),
            (True, True, DummyUnifiedTraceInstance),
        ],
    )
    def test_ops_trace_instance_routes_by_unified_switch(
        enabled: bool,
        registered: bool,
        expected_type: type[DummyTraceInstance],
        monkeypatch: pytest.MonkeyPatch,
        trace_environment: None,
        encryption_functions,
        database: Session,
    ) -> None:
        app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
        database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
        database.commit()
        apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=enabled)
        entries = {"dummy": UNIFIED_PROVIDER_ENTRY} if registered else {}
        monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap(entries))

        instance = OpsTraceManager.get_ops_trace_instance(app.id)

        assert type(instance) is expected_type

    @staticmethod
    def test_registered_unified_provider_does_not_fallback_when_construction_fails(
        monkeypatch: pytest.MonkeyPatch,
        trace_environment: None,
        encryption_functions,
        database: Session,
    ) -> None:
        app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
        database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
        database.commit()
        apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=True)
        monkeypatch.setattr(
            module,
            "unified_provider_config_map",
            FakeProviderMap(
                {
                    "dummy": {
                        "config_class": DummyConfig,
                        "trace_instance": FailingUnifiedTraceInstance,
                    }
                }
            ),
        )

        with pytest.raises(RuntimeError, match="unified constructor failed"):
            OpsTraceManager.get_ops_trace_instance(app.id)

    @staticmethod
    def test_unified_and_legacy_instances_have_separate_cache_entries(
        monkeypatch: pytest.MonkeyPatch,
        trace_environment: None,
        encryption_functions,
        database: Session,
    ) -> None:
        app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
        database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
        database.commit()
        monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap({"dummy": UNIFIED_PROVIDER_ENTRY}))

        apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=False)
        legacy = OpsTraceManager.get_ops_trace_instance(app.id)
        apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=True)
        unified = OpsTraceManager.get_ops_trace_instance(app.id)

        assert type(legacy) is DummyTraceInstance
        assert type(unified) is DummyUnifiedTraceInstance
        assert legacy is not unified

    @staticmethod
    def test_message_config_lookup_uses_real_conversation_and_model_config(database: Session) -> None:
        app = _app(database)
        config = AppModelConfig(app_id=app.id, model='{"provider":"openai"}')
        database.add(config)
        database.commit()
        conversation, message = _conversation_message(database, app, config=config)
        result = OpsTraceManager.get_app_config_through_message_id(message.id)
        assert result.id == config.id

        conversation.app_model_config_id = None
        conversation.override_model_configs = json.dumps({"provider": "override"})
        database.commit()
        override = OpsTraceManager.get_app_config_through_message_id(message.id)
        assert json.loads(override) == {"provider": "override"}

        assert OpsTraceManager.get_app_config_through_message_id("missing") is None

    @staticmethod
    @pytest.mark.parametrize("imports_cached", [False, True], ids=["cold", "warm"])
    @pytest.mark.parametrize("module_name", ["dify_trace_weave", "weave"])
    def test_provider_loader_identifies_missing_optional_dependency(module_name: str, imports_cached: bool) -> None:
        with patch.dict(sys.modules):
            if imports_cached:
                module.OpsTraceProviderConfigMap()["weave"]
            # Cached typed SDK submodules can bypass a missing top-level package.
            # Simulate its absence consistently and restore the complete cache after.
            for cached_name in list(sys.modules):
                if cached_name.partition(".")[0] in {"dify_trace_weave", "weave"}:
                    del sys.modules[cached_name]
            with patch.dict(sys.modules, {module_name: None}):
                with pytest.raises(TraceProviderNotInstalledError, match=f"weave.*{module_name}") as caught:
                    module.OpsTraceProviderConfigMap()["weave"]

        cause = caught.value.__cause__
        assert isinstance(cause, ModuleNotFoundError)
        assert cause.name is not None
        assert cause.name.partition(".")[0] == module_name

    @staticmethod
    @pytest.mark.parametrize(
        "failure",
        [
            ImportError("cannot import name 'WeaveDataTrace'"),
            ModuleNotFoundError("SDK import failed without identifying a missing module"),
            ModuleNotFoundError("No module named 'json.missing_module'", name="json.missing_module"),
        ],
    )
    def test_provider_loader_preserves_import_errors_in_installed_packages(failure: ImportError) -> None:
        original_import = builtins.__import__

        def broken_import(name, *args, **kwargs):
            if name.startswith("dify_trace_weave."):
                raise failure
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=broken_import), pytest.raises(ImportError) as caught:
            module.OpsTraceProviderConfigMap()["weave"]

        assert caught.value is failure

    @staticmethod
    def test_message_trace_reads_real_conversation_app_and_message_file(
        trace_environment: None,
        database: Session,
    ) -> None:
        app = _app(database)
        _, message = _conversation_message(database, app)
        file = MessageFile(
            message_id=message.id,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            url="path/to/file",
        )
        database.add(file)
        database.commit()
        result = TraceTask(
            trace_type=TraceTaskName.MESSAGE_TRACE,
            message_id=message.id,
        ).preprocess()
        assert result.message_id == message.id
        assert result.conversation_mode == AppMode.CHAT
        assert result.file_list[0].endswith("path/to/file")
        assert result.metadata["tenant_id"] == "tenant-1"

    @staticmethod
    def test_workflow_log_enriches_moderation_and_suggested_question_traces(
        database: Session,
    ) -> None:
        app = _app(database)
        _, message = _conversation_message(database, app)
        log = WorkflowAppLog(
            tenant_id="tenant-1",
            app_id="app-id",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            created_from=WorkflowAppLogCreatedFrom.WEB_APP,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
        )
        database.add(log)
        database.commit()
        task = TraceTask(trace_type=TraceTaskName.MODERATION_TRACE, message_id=message.id)
        moderation = ModerationInputsResult(
            action=ModerationAction.DIRECT_OUTPUT,
            preset_response="no",
            query="q",
            flagged=True,
        )
        result = task.moderation_trace(
            message.id,
            {"start": 1, "end": 2},
            moderation_result=moderation,
            inputs={"source": "payload"},
        )
        assert result.message_id == log.id
        assert result.flagged is True
        assert result.inputs == {"source": "payload"}
        suggested = task.suggested_question_trace(message.id, {"start": 1, "end": 2}, suggested_question=["q1"])
        assert suggested.message_id == log.id
        assert suggested.suggested_question == ["q1"]

    @staticmethod
    def test_dataset_retrieval_trace_serializes_documents(
        trace_environment: None,
        database: Session,
    ) -> None:
        app = _app(database)
        _, message = _conversation_message(database, app)
        document = RetrievalDocument(page_content="value")

        result = TraceTask(trace_type=TraceTaskName.DATASET_RETRIEVAL_TRACE).dataset_retrieval_trace(
            message.id,
            {"start": 1, "end": 2},
            documents=[document],
        )

        assert result.documents == [document.model_dump()]
        assert result.documents[0]["page_content"] == "value"
        assert result.metadata["tenant_id"] == "tenant-1"

    @staticmethod
    def test_workflow_trace_reads_real_workflow_log_from_owned_session(
        monkeypatch: pytest.MonkeyPatch,
        trace_environment: None,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        app = _app(database)
        log = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            created_from=WorkflowAppLogCreatedFrom.WEB_APP,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
        )
        workflow_run = WorkflowRun(
            id="run-1",
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id="workflow-1",
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="3",
            graph="{}",
            inputs=json.dumps({"query": "search"}),
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs=json.dumps({"out": "value"}),
            error=None,
            elapsed_time=10,
            total_tokens=12,
            total_steps=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            created_at=datetime(2025, 2, 20, 10, 0, 0),
            finished_at=datetime(2025, 2, 20, 10, 0, 5),
        )
        database.add_all([log, workflow_run])
        database.commit()
        repo = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
        monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
        monkeypatch.setattr(TraceTask, "_calculate_workflow_token_split", classmethod(lambda cls, *_a, **_k: (5, 7)))
        result = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE).workflow_trace(
            workflow_run_id="run-1", conversation_id=None, user_id="user-1"
        )
        assert result.workflow_run_id == "run-1"
        assert result.workflow_id == "workflow-1"
        assert result.workflow_app_log_id == log.id
        assert result.prompt_tokens == 5
        assert result.completion_tokens == 7

    @staticmethod
    def test_tool_trace_reads_real_message_file(database: Session) -> None:
        app = _app(database)
        _, message = _conversation_message(database, app)
        file = MessageFile(
            message_id=message.id,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            url="tool/file",
        )
        thought = MessageAgentThought(
            message_id=message.id,
            position=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            tool="tool-a",
            tool_meta_str=json.dumps(
                {"tool-a": {"tool_config": {}, "time_cost": 5, "error": "", "tool_parameters": {}}}
            ),
        )
        database.add_all([file, thought])
        database.commit()
        result = TraceTask(trace_type=TraceTaskName.TOOL_TRACE).tool_trace(
            message.id, {"start": 1, "end": 2}, tool_name="tool-a", tool_inputs={}, tool_outputs="result"
        )
        assert result.tool_name == "tool-a"
        assert result.time_cost == 5
        assert result.message_file_data.id == file.id

    @staticmethod
    def test_node_execution_trace_resolves_real_message_by_conversation_and_run(
        trace_environment: None, database: Session
    ) -> None:
        app = _app(database)
        conversation, message = _conversation_message(database, app)
        result = TraceTask(trace_type=TraceTaskName.NODE_EXECUTION_TRACE).node_execution_trace(
            node_execution_data={
                "tenant_id": app.tenant_id,
                "app_id": app.id,
                "conversation_id": conversation.id,
                "workflow_execution_id": message.workflow_run_id,
                "workflow_id": "workflow-1",
                "node_execution_id": "node-execution-1",
                "node_id": "node-1",
                "node_type": "llm",
                "title": "Node",
                "status": "succeeded",
            }
        )
        assert result.message_id == message.id
        assert result.metadata["conversation_id"] == conversation.id

    @staticmethod
    def test_trace_helpers_and_streaming_metrics(trace_environment: None) -> None:
        assert OpsTraceManager.check_trace_config_is_effective({}, "dummy")
        assert OpsTraceManager.get_trace_config_project_key({}, "dummy") == "fake-key"
        assert OpsTraceManager.get_trace_config_project_url({}, "dummy") == "https://project.fake"
        task = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE, message_id="message-1")
        assert task.conversation_trace(foo="bar") == {"foo": "bar"}
        assert task._extract_streaming_metrics(Message(message_metadata="invalid")) == {}
        assert task.generate_name_trace("conversation", {"start": 1, "end": 2}, tenant_id=None) == {}
        generated = task.generate_name_trace(
            "conversation",
            {"start": 1, "end": 2},
            tenant_id="tenant-1",
            generate_conversation_name="name",
            inputs="query",
        )
        assert generated.outputs == "name"
        assert generated.tenant_id == "tenant-1"
        assert generated.message_id == "message-1"

    @staticmethod
    def test_trace_queue_preserves_source_app_when_another_manager_drains(
        monkeypatch: pytest.MonkeyPatch, trace_environment: None
    ) -> None:
        monkeypatch.setattr(
            OpsTraceManager,
            "get_ops_trace_instance",
            classmethod(lambda cls, app_id: app_id == "source-app-id"),
        )
        draining_manager = TraceQueueManager(app_id="draining-app-id", user_id="user-1")
        source_manager = TraceQueueManager(app_id="source-app-id", user_id="user-2")
        task = TraceTask(
            trace_type=TraceTaskName.GENERATE_NAME_TRACE,
            conversation_id="conversation-1",
            timer={"start": 1, "end": 2},
            tenant_id="tenant-1",
            generate_conversation_name="name",
            inputs="query",
        )
        source_manager.add_trace_task(task)
        assert draining_manager.collect_tasks() == [task]

        recording_storage = RecordingStorage()
        dispatcher = RecordingDispatcher()
        monkeypatch.setattr(module.storage, "save", recording_storage.save)
        monkeypatch.setattr(module.process_trace_tasks, "apply_async", dispatcher.apply_async)
        file_id = UUID("00000000-0000-0000-0000-000000000123")
        monkeypatch.setattr(module, "uuid4", lambda: file_id)
        source_manager.add_trace_task(task)
        draining_manager.run()

        assert len(recording_storage.writes) == 1
        path, data = recording_storage.writes[0]
        assert path.endswith(f"source-app-id/{file_id.hex}.json")
        assert json.loads(data)["app_id"] == "source-app-id"
        assert dispatcher.payloads == [{"file_id": file_id.hex, "app_id": "source-app-id"}]

    @staticmethod
    def test_trace_queue_persists_with_caller_supplied_file_id(
        monkeypatch: pytest.MonkeyPatch, trace_environment: None
    ) -> None:
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
        manager = TraceQueueManager(app_id="app-id", user_id="user-1")
        task = TraceTask(
            trace_type=TraceTaskName.GENERATE_NAME_TRACE,
            conversation_id="conversation-1",
            timer={"start": 1, "end": 2},
            tenant_id="tenant-1",
            generate_conversation_name="name",
            inputs="query",
        )
        task.app_id = "app-id"
        recording_storage = RecordingStorage()
        monkeypatch.setattr(module.storage, "save", recording_storage.save)

        file_info = manager.persist_trace_task(task, file_id="workflow-final-run-1")

        assert file_info == {"file_id": "workflow-final-run-1", "app_id": "app-id"}
        path, data = recording_storage.writes[0]
        payload = json.loads(data)
        assert path == "ops_trace/app-id/workflow-final-run-1.json"
        assert UUID(payload["trace_info"]["operation_id"])

    @staticmethod
    def test_trace_queue_persistence_error_propagates(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
        manager = TraceQueueManager(app_id="app-id", user_id="user-1")
        task = TraceTask(trace_type=TraceTaskName.GENERATE_NAME_TRACE)
        task.app_id = "app-id"

        def fail_save(_path: str, _data: bytes) -> None:
            raise OSError("storage unavailable")

        monkeypatch.setattr(module.storage, "save", fail_save)

        with pytest.raises(OSError, match="storage unavailable"):
            manager.persist_trace_task(task, file_id="workflow-final-run-1")

    @staticmethod
    def test_trace_queue_enqueue_error_propagates(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
        manager = TraceQueueManager(app_id="app-id", user_id="user-1")

        def fail_enqueue(*_args: object, **_kwargs: object) -> None:
            raise ConnectionError("broker unavailable")

        monkeypatch.setattr(module.process_trace_tasks, "apply_async", fail_enqueue)

        with pytest.raises(ConnectionError, match="broker unavailable"):
            manager.enqueue_persisted_trace({"file_id": "workflow-final-run-1", "app_id": "app-id"})


"""Unit tests for TraceQueueManager telemetry guard.

Verifies that TraceQueueManager.add_trace_task() only enqueues tasks when at
least one consumer is active:
- Enterprise telemetry is enabled (_enterprise_telemetry_enabled=True), OR
- A third-party trace instance (Langfuse, etc.) is configured

When neither is active, tasks are silently dropped to avoid unnecessary work.

When BOTH are false, tasks are silently dropped (correct behavior).
"""


class TestTraceQueueManagerCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _application_tracing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)

    @staticmethod
    @pytest.fixture
    def trace_queue_manager_and_task():
        """Exercise the production guard without starting background dispatch."""
        from core.ops.entities.trace_entity import TraceTaskName
        from core.ops.ops_trace_manager import TraceQueueManager, TraceTask

        with patch.object(TraceQueueManager, "start_timer"):
            yield TraceQueueManager, TraceTask, TraceTaskName

    class TestTraceQueueManagerTelemetryGuard:
        """Test TraceQueueManager's telemetry guard in add_trace_task()."""

        def test_task_not_enqueued_when_telemetry_disabled_and_no_trace_instance(self, trace_queue_manager_and_task):
            """Verify task is NOT enqueued when telemetry disabled and no trace instance.

            This is the core guard: when _enterprise_telemetry_enabled=False AND
            trace_instance=None, the task should be silently dropped.
            """
            trace_queue_manager, trace_task_type, trace_task_name = trace_queue_manager_and_task

            trace_queue = queue.Queue()

            trace_task = trace_task_type(trace_type=trace_task_name.WORKFLOW_TRACE)

            with (
                patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
                patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
                patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
            ):
                manager = trace_queue_manager(app_id="test-app-id")
                manager.add_trace_task(trace_task)

                assert trace_queue.empty()

        def test_task_enqueued_when_telemetry_enabled(self, trace_queue_manager_and_task):
            """Verify task IS enqueued when enterprise telemetry is enabled.

            When _enterprise_telemetry_enabled=True, the task should be enqueued
            regardless of trace_instance state.
            """
            trace_queue_manager, trace_task_type, trace_task_name = trace_queue_manager_and_task

            trace_queue = queue.Queue()

            trace_task = trace_task_type(trace_type=trace_task_name.WORKFLOW_TRACE)

            with (
                patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
                patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
                patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
            ):
                manager = trace_queue_manager(app_id="test-app-id")
                manager.add_trace_task(trace_task)

                called_task = trace_queue.get_nowait()
                assert called_task is trace_task
                assert trace_queue.empty()
                assert called_task.app_id == "test-app-id"

        def test_task_enqueued_when_trace_instance_configured(self, trace_queue_manager_and_task):
            """Verify task IS enqueued when third-party trace instance is configured.

            When trace_instance is not None (e.g., Langfuse configured), the task
            should be enqueued even if enterprise telemetry is disabled.
            """
            trace_queue_manager, trace_task_type, trace_task_name = trace_queue_manager_and_task

            trace_queue = queue.Queue()

            mock_trace_instance = MagicMock()

            trace_task = trace_task_type(trace_type=trace_task_name.WORKFLOW_TRACE)

            with (
                patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
                patch(
                    "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance",
                    return_value=mock_trace_instance,
                ),
                patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
            ):
                manager = trace_queue_manager(app_id="test-app-id")
                manager.add_trace_task(trace_task)

                called_task = trace_queue.get_nowait()
                assert called_task is trace_task
                assert trace_queue.empty()
                assert called_task.app_id == "test-app-id"

        def test_task_enqueued_when_both_telemetry_and_trace_instance_enabled(self, trace_queue_manager_and_task):
            """Verify task IS enqueued when both telemetry and trace instance are enabled.

            When both _enterprise_telemetry_enabled=True AND trace_instance is set,
            the task should definitely be enqueued.
            """
            trace_queue_manager, trace_task_type, trace_task_name = trace_queue_manager_and_task

            trace_queue = queue.Queue()

            mock_trace_instance = MagicMock()

            trace_task = trace_task_type(trace_type=trace_task_name.WORKFLOW_TRACE)

            with (
                patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
                patch(
                    "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance",
                    return_value=mock_trace_instance,
                ),
                patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
            ):
                manager = trace_queue_manager(app_id="test-app-id")
                manager.add_trace_task(trace_task)

                called_task = trace_queue.get_nowait()
                assert called_task is trace_task
                assert trace_queue.empty()
                assert called_task.app_id == "test-app-id"

        def test_app_id_set_before_enqueue(self, trace_queue_manager_and_task):
            """Verify app_id is set on the task before enqueuing.

            The guard logic sets trace_task.app_id = self.app_id before calling
            trace_manager_queue.put(trace_task). This test verifies that behavior.
            """
            trace_queue_manager, trace_task_type, trace_task_name = trace_queue_manager_and_task

            trace_queue = queue.Queue()

            trace_task = trace_task_type(trace_type=trace_task_name.WORKFLOW_TRACE)

            with (
                patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
                patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
                patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
            ):
                manager = trace_queue_manager(app_id="expected-app-id")
                manager.add_trace_task(trace_task)

                called_task = trace_queue.get_nowait()
                assert called_task is trace_task
                assert trace_queue.empty()
                assert called_task.app_id == "expected-app-id"

    @staticmethod
    @pytest.mark.parametrize("enabled_at_start", [False, True])
    def test_application_pipeline_snapshots_switch_without_constructing_sdk(
        trace_queue_manager_and_task, monkeypatch: pytest.MonkeyPatch, enabled_at_start: bool
    ):
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        trace_queue_manager, trace_task_class, trace_task_name = trace_queue_manager_and_task
        trace_queue = queue.Queue()
        calls: list[object] = []
        current_enabled = enabled_at_start

        def queue_enabled(app_id: object) -> bool:
            calls.append(app_id)
            return current_enabled

        monkeypatch.setattr(RuntimeApplicationTracingHooks, "queue_enabled_at_start", staticmethod(queue_enabled))
        hooks = RuntimeApplicationTracingHooks()
        app = Flask(__name__)
        bind_application_tracing_hooks(app, hooks)
        with (
            app.app_context(),
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance") as legacy,
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = trace_queue_manager(app_id="app-id")
            current_enabled = not enabled_at_start
            task = trace_task_class(trace_type=trace_task_name.WORKFLOW_TRACE)
            manager.add_trace_task(task)
        legacy.assert_not_called()
        assert calls == ["app-id"]
        assert manager.trace_instance is None
        assert trace_queue.qsize() == int(enabled_at_start)


"""Nullable provider credentials never reach RSA/base64 as non-string tokens."""


@pytest.fixture
def workspace(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> str:
    key = RSA.generate(2048)
    tenant_id = str(uuid4())
    sqlite_session.add(make_tenant(tenant_id=tenant_id, encrypt_public_key=key.publickey().export_key().decode()))
    sqlite_session.commit()
    monkeypatch.setattr(model_engine.db, "session", sqlite_session)
    monkeypatch.setattr(key_provider_manager, "_provider", RSAKeyProvider())
    monkeypatch.setattr(rsa, "get_decrypt_decoding", lambda _tenant: (key, gmpy2_pkcs10aep_cipher.new(key)))
    return tenant_id


class TestNullableTracingCredentialsCases:
    @staticmethod
    def test_databricks_switches_auth_with_real_encryption_and_explicit_null(workspace: str) -> None:
        pat = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "databricks",
            {
                "host": "https://workspace.test",
                "experiment_id": "12",
                "personal_access_token": "synthetic-pat",
                "client_id": None,
                "client_secret": None,
            },
        )
        assert pat["personal_access_token"] != "synthetic-pat"
        decrypted_pat = OpsTraceManager.decrypt_tracing_config(workspace, "databricks", pat)
        assert decrypted_pat["personal_access_token"] == "synthetic-pat"
        assert decrypted_pat["client_secret"] is None

        oauth = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "databricks",
            {
                "host": "https://workspace.test",
                "experiment_id": "12",
                "personal_access_token": None,
                "client_id": "synthetic-client",
                "client_secret": "synthetic-secret",
            },
            pat,
        )
        assert oauth["personal_access_token"] is None
        assert oauth["client_secret"] != "synthetic-secret"
        decrypted_oauth = OpsTraceManager.decrypt_tracing_config(workspace, "databricks", oauth)
        assert decrypted_oauth["personal_access_token"] is None
        assert decrypted_oauth["client_secret"] == "synthetic-secret"

    @staticmethod
    def test_other_optional_secret_model_can_be_cleared_without_losing_validation(workspace: str) -> None:
        password = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "mlflow",
            {
                "tracking_uri": "https://mlflow.test",
                "experiment_id": "0",
                "username": "user",
                "password": "synthetic-password",
            },
        )
        assert OpsTraceManager.decrypt_tracing_config(workspace, "mlflow", password)["password"] == "synthetic-password"
        cleared = OpsTraceManager.encrypt_tracing_config(workspace, "mlflow", {**password, "password": None}, password)
        assert cleared["password"] is None
        assert OpsTraceManager.decrypt_tracing_config(workspace, "mlflow", cleared)["password"] is None

    @staticmethod
    def test_non_nullable_secret_is_still_rejected_by_provider_model(workspace: str) -> None:
        with pytest.raises(ValidationError, match="secret_key"):
            OpsTraceManager.encrypt_tracing_config(
                workspace, "langfuse", {"public_key": "synthetic-public", "secret_key": None}
            )
        encrypted = OpsTraceManager.encrypt_tracing_config(
            workspace, "langfuse", {"public_key": "synthetic-public", "secret_key": "synthetic-secret"}
        )
        with pytest.raises(ValidationError, match="secret_key"):
            OpsTraceManager.decrypt_tracing_config(workspace, "langfuse", {**encrypted, "secret_key": None})
