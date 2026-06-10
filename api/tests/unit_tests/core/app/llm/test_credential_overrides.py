"""Unit tests for DifyCredentialsProvider credential_overrides behaviour.

Covers:
- Override path: alias resolution, provider mismatch, tenant scoping
- Caching of overridden credentials
- Decryption of encrypted fields with pass-through for plaintext values
- Fallback to default resolution when no override is present
"""

import json
from types import SimpleNamespace
from unittest import mock

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.llm.model_access import DifyCredentialsProvider
from core.errors.error import ProviderTokenNotInitError


def _build_run_context(tenant_id: str = "tenant-1") -> DifyRunContext:
    return DifyRunContext(
        tenant_id=tenant_id,
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
    )


def _build_credential_record(
    *,
    credential_id: str = "cred-1",
    tenant_id: str = "tenant-1",
    provider_name: str = "langgenius/groq/groq",
    encrypted_config: str | None = None,
) -> SimpleNamespace:
    """Build a lightweight stand-in for a ProviderCredential row."""
    if encrypted_config is None:
        encrypted_config = json.dumps({"api_key": "encrypted-api-key", "endpoint_url": "https://api.groq.com"})
    return SimpleNamespace(
        id=credential_id,
        tenant_id=tenant_id,
        provider_name=provider_name,
        encrypted_config=encrypted_config,
    )


def _patch_session(credential_record):
    """Return a context manager that patches session_factory to return the given record."""
    mock_session = mock.MagicMock()
    mock_session.__enter__ = mock.MagicMock(return_value=mock_session)
    mock_session.__exit__ = mock.MagicMock(return_value=False)
    mock_session.scalar.return_value = credential_record
    return mock.patch(
        "core.app.llm.model_access.session_factory.create_session",
        return_value=mock_session,
    )


# ---------------------------------------------------------------------------
# 1. Override resolves credential by ID and decrypts
# ---------------------------------------------------------------------------
class TestCredentialOverrideResolution:
    def test_override_fetches_and_decrypts_credential(self):
        """When a valid override is provided, fetch() should look up the credential
        by ID, decrypt encrypted fields, and return the result."""
        record = _build_credential_record()

        with (
            _patch_session(record),
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=lambda tenant_id, token: f"decrypted:{token}",
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"langgenius/groq/groq": "cred-1"},
            )
            result = provider.fetch("langgenius/groq/groq", "llama-3.3-70b-versatile")

        assert result["api_key"] == "decrypted:encrypted-api-key"
        # endpoint_url should also attempt decrypt; our mock decrypts everything
        assert result["endpoint_url"] == "decrypted:https://api.groq.com"

    def test_override_passthrough_for_undecryptable_fields(self):
        """Fields that fail decryption (e.g. plain URLs) should be kept as-is."""
        record = _build_credential_record()

        def selective_decrypt(tenant_id: str, token: str) -> str:
            if token == "encrypted-api-key":
                return "real-api-key"
            raise ValueError("Not encrypted")

        with (
            _patch_session(record),
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=selective_decrypt,
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"langgenius/groq/groq": "cred-1"},
            )
            result = provider.fetch("langgenius/groq/groq", "llama-3.3-70b-versatile")

        assert result["api_key"] == "real-api-key"
        assert result["endpoint_url"] == "https://api.groq.com"


# ---------------------------------------------------------------------------
# 2. Provider alias resolution
# ---------------------------------------------------------------------------
class TestProviderAliasResolution:
    def test_override_under_short_name_matches_full_provider_name(self):
        """Override keyed as 'groq' should match when fetch() is called with
        'langgenius/groq/groq'."""
        record = _build_credential_record(provider_name="groq")

        with (
            _patch_session(record),
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=lambda tenant_id, token: token,
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"groq": "cred-1"},
            )
            result = provider.fetch("langgenius/groq/groq", "llama-3.3-70b-versatile")

        assert result["api_key"] == "encrypted-api-key"

    def test_override_under_full_name_matches_short_provider_name(self):
        """Override keyed as 'langgenius/openai/openai' should match when fetch()
        is called with 'openai'."""
        record = _build_credential_record(provider_name="langgenius/openai/openai")

        with (
            _patch_session(record),
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=lambda tenant_id, token: token,
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"langgenius/openai/openai": "cred-1"},
            )
            result = provider.fetch("openai", "gpt-4")

        assert result["api_key"] == "encrypted-api-key"

    def test_credential_record_provider_alias_accepted_in_validation(self):
        """A credential stored under 'openai' should not be rejected when the
        runtime requests 'langgenius/openai/openai' (alias match)."""
        record = _build_credential_record(provider_name="openai")

        with (
            _patch_session(record),
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=lambda tenant_id, token: token,
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"langgenius/openai/openai": "cred-1"},
            )
            # Should NOT raise ValueError about provider mismatch
            result = provider.fetch("langgenius/openai/openai", "gpt-4")

        assert "api_key" in result


# ---------------------------------------------------------------------------
# 3. Provider mismatch rejection
# ---------------------------------------------------------------------------
class TestProviderMismatchHandling:
    def test_credential_for_wrong_provider_raises_value_error(self):
        """If a credential belongs to 'anthropic' but the override maps it to
        'openai', a ValueError must be raised."""
        record = _build_credential_record(provider_name="anthropic")

        with (
            _patch_session(record),
            mock.patch("core.app.llm.model_access.encrypter.decrypt_token"),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"openai": "cred-1"},
            )
            with pytest.raises(ValueError, match="belongs to provider 'anthropic'"):
                provider.fetch("openai", "gpt-4")


# ---------------------------------------------------------------------------
# 4. Tenant scoping
# ---------------------------------------------------------------------------
class TestTenantScoping:
    def test_credential_not_found_raises_provider_token_error(self):
        """If the credential ID does not exist (or belongs to another tenant),
        ProviderTokenNotInitError must be raised."""
        with _patch_session(None):  # No record found
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"openai": "nonexistent-cred"},
            )
            with pytest.raises(ProviderTokenNotInitError, match="not found or does not belong"):
                provider.fetch("openai", "gpt-4")


# ---------------------------------------------------------------------------
# 5. Caching
# ---------------------------------------------------------------------------
class TestOverrideCaching:
    def test_second_fetch_uses_cache(self):
        """After the first fetch with an override, the second call should return
        a cached copy without hitting the DB again."""
        record = _build_credential_record()

        mock_session_obj = mock.MagicMock()
        mock_session_obj.__enter__ = mock.MagicMock(return_value=mock_session_obj)
        mock_session_obj.__exit__ = mock.MagicMock(return_value=False)
        mock_session_obj.scalar.return_value = record

        with (
            mock.patch(
                "core.app.llm.model_access.session_factory.create_session",
                return_value=mock_session_obj,
            ) as mock_create_session,
            mock.patch(
                "core.app.llm.model_access.encrypter.decrypt_token",
                side_effect=lambda tenant_id, token: token,
            ),
        ):
            provider = DifyCredentialsProvider(
                run_context=_build_run_context(),
                provider_manager=mock.MagicMock(),
                credential_overrides={"langgenius/groq/groq": "cred-1"},
            )
            first = provider.fetch("langgenius/groq/groq", "llama-3.3-70b-versatile")
            second = provider.fetch("langgenius/groq/groq", "llama-3.3-70b-versatile")

        # DB session should only have been created once
        assert mock_create_session.call_count == 1
        # Results should be equal but not the same object (deepcopy)
        assert first == second
        assert first is not second


# ---------------------------------------------------------------------------
# 6. Fallback to default when no override is present
# ---------------------------------------------------------------------------
class TestFallbackToDefault:
    def test_no_override_uses_default_resolution(self):
        """When no credential_overrides are provided for a provider, the default
        provider_manager resolution path should be used."""
        mock_provider_manager = mock.MagicMock()
        mock_configurations = mock.MagicMock()
        mock_provider_configuration = mock.MagicMock()
        mock_provider_model = mock.MagicMock()

        mock_configurations.get.return_value = mock_provider_configuration
        mock_provider_configuration.get_provider_model.return_value = mock_provider_model
        mock_provider_configuration.get_current_credentials.return_value = {"api_key": "default-key"}
        mock_provider_manager.get_configurations.return_value = mock_configurations

        provider = DifyCredentialsProvider(
            run_context=_build_run_context(),
            provider_manager=mock_provider_manager,
            credential_overrides={},  # No overrides
        )
        result = provider.fetch("openai", "gpt-4")

        assert result == {"api_key": "default-key"}
        mock_provider_manager.get_configurations.assert_called_once_with("tenant-1")

    def test_override_for_different_provider_does_not_interfere(self):
        """An override for 'groq' should not affect a fetch for 'openai'."""
        mock_provider_manager = mock.MagicMock()
        mock_configurations = mock.MagicMock()
        mock_provider_configuration = mock.MagicMock()
        mock_provider_model = mock.MagicMock()

        mock_configurations.get.return_value = mock_provider_configuration
        mock_provider_configuration.get_provider_model.return_value = mock_provider_model
        mock_provider_configuration.get_current_credentials.return_value = {"api_key": "default-openai-key"}
        mock_provider_manager.get_configurations.return_value = mock_configurations

        provider = DifyCredentialsProvider(
            run_context=_build_run_context(),
            provider_manager=mock_provider_manager,
            credential_overrides={"langgenius/groq/groq": "cred-1"},  # Only Groq overridden
        )
        result = provider.fetch("openai", "gpt-4")

        assert result == {"api_key": "default-openai-key"}
        mock_provider_manager.get_configurations.assert_called_once()
