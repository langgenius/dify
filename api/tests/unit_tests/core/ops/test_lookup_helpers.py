"""Unit tests for lookup helper functions in core.ops.ops_trace_manager.

Covers:
- _lookup_app_and_workspace_names
- _lookup_credential_name
- _lookup_llm_credential_info
- TraceTask._get_user_id_from_metadata
"""

from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db_and_session_patches(scalar_side_effect=None, scalar_return_value=None):
    """Return (mock_db, cm, session) ready to patch 'core.ops.ops_trace_manager.db'
    and 'core.ops.ops_trace_manager.Session'.

    Provide either scalar_side_effect (list, for multiple calls) or
    scalar_return_value (single value).
    """
    mock_db = MagicMock()
    mock_db.engine = MagicMock()

    session = MagicMock()
    if scalar_side_effect is not None:
        session.scalar.side_effect = scalar_side_effect
    else:
        session.scalar.return_value = scalar_return_value

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session)
    cm.__exit__ = MagicMock(return_value=False)

    return mock_db, cm, session


# ---------------------------------------------------------------------------
# _lookup_app_and_workspace_names
# ---------------------------------------------------------------------------


class TestLookupAppAndWorkspaceNames:
    """Tests for _lookup_app_and_workspace_names(app_id, tenant_id)."""

    def test_both_found(self):
        """Returns (app_name, workspace_name) when both records exist."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=["MyApp", "MyWorkspace"])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names("app-123", "tenant-456")

        assert app_name == "MyApp"
        assert workspace_name == "MyWorkspace"

    def test_app_only_found(self):
        """Returns (app_name, '') when tenant record is absent."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=["MyApp", None])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names("app-123", "tenant-456")

        assert app_name == "MyApp"
        assert workspace_name == ""

    def test_tenant_only_found(self):
        """Returns ('', workspace_name) when app record is absent."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=[None, "MyWorkspace"])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names("app-123", "tenant-456")

        assert app_name == ""
        assert workspace_name == "MyWorkspace"

    def test_neither_found(self):
        """Returns ('', '') when both DB lookups return None."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=[None, None])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names("app-123", "tenant-456")

        assert app_name == ""
        assert workspace_name == ""

    def test_none_inputs_skips_db(self):
        """Returns ('', '') immediately when both IDs are None — no DB access."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names(None, None)

        mock_session_cls.assert_not_called()
        assert app_name == ""
        assert workspace_name == ""

    def test_app_id_none_only_queries_tenant(self):
        """When app_id is None, only the tenant query is issued."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, session = _make_db_and_session_patches(scalar_return_value="OnlyWorkspace")

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names(None, "tenant-456")

        assert app_name == ""
        assert workspace_name == "OnlyWorkspace"
        assert session.scalar.call_count == 1

    def test_tenant_id_none_only_queries_app(self):
        """When tenant_id is None, only the app query is issued."""
        from core.ops.ops_trace_manager import _lookup_app_and_workspace_names

        mock_db, cm, session = _make_db_and_session_patches(scalar_return_value="OnlyApp")

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            app_name, workspace_name = _lookup_app_and_workspace_names("app-123", None)

        assert app_name == "OnlyApp"
        assert workspace_name == ""
        assert session.scalar.call_count == 1


# ---------------------------------------------------------------------------
# _lookup_credential_name
# ---------------------------------------------------------------------------


class TestLookupCredentialName:
    """Tests for _lookup_credential_name(credential_id, provider_type)."""

    @pytest.mark.parametrize("provider_type", ["builtin", "plugin", "api", "workflow", "mcp"])
    def test_known_provider_types_return_name(self, provider_type):
        """Each valid provider_type results in a DB query and returns the credential name."""
        from core.ops.ops_trace_manager import _lookup_credential_name

        mock_db, cm, session = _make_db_and_session_patches(scalar_return_value="CredentialA")

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            result = _lookup_credential_name("cred-123", provider_type)

        assert result == "CredentialA"
        session.scalar.assert_called_once()

    def test_credential_not_found_returns_empty_string(self):
        """Returns '' when DB yields None for the given credential_id."""
        from core.ops.ops_trace_manager import _lookup_credential_name

        mock_db, cm, _session = _make_db_and_session_patches(scalar_return_value=None)

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            result = _lookup_credential_name("cred-999", "api")

        assert result == ""

    def test_invalid_provider_type_returns_empty_string_without_db(self):
        """Returns '' immediately for an unrecognised provider_type — no DB access."""
        from core.ops.ops_trace_manager import _lookup_credential_name

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            result = _lookup_credential_name("cred-123", "unknown_type")

        mock_session_cls.assert_not_called()
        assert result == ""

    def test_none_credential_id_returns_empty_string_without_db(self):
        """Returns '' immediately when credential_id is None — no DB access."""
        from core.ops.ops_trace_manager import _lookup_credential_name

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            result = _lookup_credential_name(None, "api")

        mock_session_cls.assert_not_called()
        assert result == ""

    def test_none_provider_type_returns_empty_string_without_db(self):
        """Returns '' immediately when provider_type is None — no DB access."""
        from core.ops.ops_trace_manager import _lookup_credential_name

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            result = _lookup_credential_name("cred-123", None)

        mock_session_cls.assert_not_called()
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

    def _provider_record(self, credential_id: str | None = None) -> MagicMock:
        record = MagicMock()
        record.credential_id = credential_id
        return record

    def _model_record(self, credential_id: str | None = None) -> MagicMock:
        record = MagicMock()
        record.credential_id = credential_id
        return record

    def test_model_level_credential_found(self):
        """Returns model-level credential_id and name when ProviderModel has a credential."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id=None)
        model_record = self._model_record(credential_id="model-cred-id")

        # scalar calls: (1) Provider, (2) ProviderModel, (3) ProviderModelCredential.credential_name
        mock_db, cm, _session = _make_db_and_session_patches(
            scalar_side_effect=[provider_record, model_record, "ModelCredName"]
        )

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id == "model-cred-id"
        assert cred_name == "ModelCredName"

    def test_provider_level_fallback_when_no_model_credential(self):
        """Falls back to provider-level credential when ProviderModel has no credential_id."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id="prov-cred-id")
        model_record = self._model_record(credential_id=None)

        # scalar calls: (1) Provider, (2) ProviderModel (no cred), (3) ProviderCredential.credential_name
        mock_db, cm, _session = _make_db_and_session_patches(
            scalar_side_effect=[provider_record, model_record, "ProvCredName"]
        )

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id == "prov-cred-id"
        assert cred_name == "ProvCredName"

    def test_provider_level_fallback_when_no_model_record(self):
        """Falls back to provider-level credential when no ProviderModel row exists."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id="prov-cred-id")

        # scalar calls: (1) Provider, (2) ProviderModel → None, (3) ProviderCredential.credential_name
        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=[provider_record, None, "ProvCredName"])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id == "prov-cred-id"
        assert cred_name == "ProvCredName"

    def test_no_model_arg_uses_provider_level_only(self):
        """When model is None, skips ProviderModel query and uses provider credential."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id="prov-cred-id")

        # scalar calls: (1) Provider, (2) ProviderCredential.credential_name — no ProviderModel
        mock_db, cm, session = _make_db_and_session_patches(scalar_side_effect=[provider_record, "ProvCredName"])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", None)

        assert cred_id == "prov-cred-id"
        assert cred_name == "ProvCredName"
        assert session.scalar.call_count == 2

    def test_provider_not_found_returns_none_and_empty(self):
        """Returns (None, '') when Provider record does not exist."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        mock_db, cm, _session = _make_db_and_session_patches(scalar_return_value=None)

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id is None
        assert cred_name == ""

    def test_none_tenant_id_returns_none_and_empty_without_db(self):
        """Returns (None, '') immediately when tenant_id is None — no DB access."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            cred_id, cred_name = _lookup_llm_credential_info(None, "openai", "gpt-4")

        mock_session_cls.assert_not_called()
        assert cred_id is None
        assert cred_name == ""

    def test_none_provider_returns_none_and_empty_without_db(self):
        """Returns (None, '') immediately when provider is None — no DB access."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        mock_db = MagicMock()
        mock_session_cls = MagicMock()

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", mock_session_cls),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", None, "gpt-4")

        mock_session_cls.assert_not_called()
        assert cred_id is None
        assert cred_name == ""

    def test_db_error_on_outer_query_returns_none_and_empty(self):
        """Returns (None, '') and logs a warning when the outer DB query raises."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        mock_db, cm, session = _make_db_and_session_patches()
        session.scalar.side_effect = Exception("DB connection failed")

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id is None
        assert cred_name == ""

    def test_credential_name_lookup_failure_returns_id_with_empty_name(self):
        """When credential name sub-query fails, returns cred_id but '' for name."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id="prov-cred-id")

        # Provider found, no model record, then name lookup raises
        mock_db, cm, _session = _make_db_and_session_patches(
            scalar_side_effect=[provider_record, None, Exception("deleted")]
        )

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

        assert cred_id == "prov-cred-id"
        assert cred_name == ""

    def test_no_credential_on_provider_or_model_returns_none_id(self):
        """Returns (None, '') when neither provider nor model has a credential_id."""
        from core.ops.ops_trace_manager import _lookup_llm_credential_info

        provider_record = self._provider_record(credential_id=None)
        model_record = self._model_record(credential_id=None)

        mock_db, cm, _session = _make_db_and_session_patches(scalar_side_effect=[provider_record, model_record])

        with (
            patch("core.ops.ops_trace_manager.db", mock_db),
            patch("core.ops.ops_trace_manager.Session", return_value=cm),
        ):
            cred_id, cred_name = _lookup_llm_credential_info("tenant-1", "openai", "gpt-4")

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
