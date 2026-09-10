"""Unit tests for lookup helper functions in core.ops.ops_trace_manager.

Covers:
- _lookup_app_and_workspace_names
- _lookup_credential_name
- _lookup_llm_credential_info
- TraceTask._get_user_id_from_metadata
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import PropertyMock, patch

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ApiProviderSchemaType
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.base import TypeBase
from models.model import App, AppMode, IconType
from models.provider import Provider, ProviderCredential, ProviderModel, ProviderModelCredential, ProviderType
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
