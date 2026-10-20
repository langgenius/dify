"""Installed Gmail ``get_message`` metadata against the audited profile.

Daemon transport is replaced by fake metadata owners; no request leaves the
process. Actual qualification is UNAVAILABLE (all three constants ``None``).
Every "qualified" case below uses SYNTHETIC test-only constants that exercise
exact matching; they are not evidence about any installed or deployed artifact.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from core.plugin.entities.plugin import PluginInstallation
from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from services.dify_builder import real_call_metadata
from services.dify_builder.application import gmail_read_policy
from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

TENANT = "tenant-1"
PLUGIN = "langgenius/dify-gmail"
PROVIDER = "langgenius/dify-gmail/dify-gmail"
# SYNTHETIC test-only artifact; never a reviewed or deployed revision.
SYNTHETIC_VERSION = "9.9.9"
SYNTHETIC_CHECKSUM = "f" * 64
SYNTHETIC_ARTIFACT = f"{PLUGIN}:{SYNTHETIC_VERSION}@{SYNTHETIC_CHECKSUM}"
SYNTHETIC_AUDIT = "synthetic-test-audit-revision"
I18N = {"en_US": "Gmail"}


def tool_declaration(**overrides: object) -> dict[str, object]:
    return {
        "identity": {"author": "langgenius", "name": "get_message", "label": I18N, "provider": PROVIDER},
        "description": {"human": I18N, "llm": "Read one message"},
        "parameters": [
            {"name": "message_id", "label": I18N, "type": "string", "form": "llm", "required": True},
            {"name": "include_body", "label": I18N, "type": "boolean", "form": "form", "required": False},
            {"name": "include_attachments", "label": I18N, "type": "boolean", "form": "form", "required": False},
        ],
        **overrides,
    }


def provider_entity(
    *, unique_identifier: str = SYNTHETIC_ARTIFACT, tools: list[dict[str, object]] | None = None, **overrides: object
) -> PluginToolProviderEntity:
    return PluginToolProviderEntity.model_validate(
        {
            "provider": "dify-gmail",
            "plugin_id": PLUGIN,
            "plugin_unique_identifier": unique_identifier,
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": PROVIDER,
                    "description": I18N,
                    "icon": "icon.svg",
                    "label": I18N,
                },
                "tools": [tool_declaration()] if tools is None else tools,
            },
            **overrides,
        }
    )


def installation(**overrides: object) -> PluginInstallation:
    now = datetime(2026, 10, 11, tzinfo=UTC)
    return PluginInstallation.model_validate(
        {
            "id": "installation-1",
            "created_at": now,
            "updated_at": now,
            "tenant_id": TENANT,
            "endpoints_setups": 0,
            "endpoints_active": 0,
            "runtime_type": "local",
            "source": "marketplace",
            "meta": {},
            "plugin_id": PLUGIN,
            "plugin_unique_identifier": SYNTHETIC_ARTIFACT,
            "version": SYNTHETIC_VERSION,
            "checksum": SYNTHETIC_CHECKSUM,
            "declaration": {
                "version": SYNTHETIC_VERSION,
                "author": "langgenius",
                "name": "dify-gmail",
                "description": I18N,
                "icon": "icon.svg",
                "label": I18N,
                "created_at": now,
                "resource": {"memory": 1},
                "plugins": {},
                "meta": {},
            },
            **overrides,
        }
    )


SYNTHETIC_SCHEMA = real_call_metadata.get_message_schema_digest(provider_entity().declaration.tools[0])


class FakeMetadata:
    """Fake native metadata owners recording every read."""

    def __init__(self) -> None:
        self.installations: list[PluginInstallation] | Exception = [installation()]
        self.provider: PluginToolProviderEntity | Exception = provider_entity()
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        fake = self

        class Installer:
            def fetch_plugin_installation_by_ids(
                self, tenant_id: str, plugin_ids: list[str]
            ) -> list[PluginInstallation]:
                fake.calls.append(("installations", (tenant_id, tuple(plugin_ids))))
                if isinstance(fake.installations, Exception):
                    raise fake.installations
                return fake.installations

        class ToolManager:
            def fetch_tool_provider(self, tenant_id: str, provider: str) -> PluginToolProviderEntity:
                fake.calls.append(("provider", (tenant_id, provider)))
                if isinstance(fake.provider, Exception):
                    raise fake.provider
                return fake.provider

        self.installer = Installer
        self.tool_manager = ToolManager


@pytest.fixture(autouse=True)
def forbidden_effects(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Metadata reads only: invoke/validate/runtime/OAuth/decrypt/DB sessions fail the test."""
    from sqlalchemy.orm import Session

    from core.helper import encrypter
    from core.helper.provider_encryption import ProviderConfigEncrypter
    from core.plugin.impl.oauth import OAuthHandler
    from core.plugin.impl.tool import PluginToolManager
    from core.tools.tool_manager import ToolManager
    from core.tools.utils import system_encryption

    targets: list[tuple[object, str]] = [
        (PluginToolManager, "invoke"),
        (PluginToolManager, "validate_provider_credentials"),
        (PluginToolManager, "get_runtime_parameters"),
        (ToolManager, "get_builtin_provider"),
        (ToolManager, "get_tool_runtime"),
        (OAuthHandler, "get_credentials"),
        (OAuthHandler, "refresh_credentials"),
        (ProviderConfigEncrypter, "decrypt"),
        (encrypter, "decrypt_token"),
        (system_encryption, "decrypt_system_params"),
        # Installed metadata is read outside any database transaction.
        (Session, "__init__"),
    ]
    spies = []
    for owner, name in targets:
        spy = Mock(side_effect=AssertionError("unexpected effect"))
        monkeypatch.setattr(owner, name, spy)
        spies.append(spy)
    yield
    for spy in spies:
        spy.assert_not_called()


@pytest.fixture
def metadata(monkeypatch: pytest.MonkeyPatch) -> FakeMetadata:
    fake = FakeMetadata()
    monkeypatch.setattr(real_call_metadata, "PluginInstaller", fake.installer)
    monkeypatch.setattr(real_call_metadata, "PluginToolManager", fake.tool_manager)
    return fake


@pytest.fixture
def synthetic_qualified(monkeypatch: pytest.MonkeyPatch) -> None:
    """SYNTHETIC qualification so exact matching can be exercised; not runtime evidence."""
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_ARTIFACT", SYNTHETIC_ARTIFACT)
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_SCHEMA_DIGEST", SYNTHETIC_SCHEMA)
    monkeypatch.setattr(gmail_read_policy, "GMAIL_SOURCE_AUDIT_REVISION", SYNTHETIC_AUDIT)


def refused(reason: str, *, provider_id: str = PROVIDER, tenant_id: str = TENANT) -> BuilderExecutionPolicyError:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        real_call_metadata.resolve_installed_get_message(tenant_id=tenant_id, provider_id=provider_id)
    assert raised.value.reason_code == reason
    return raised.value


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize("tenant_id", ["", "t" * 129])
def test_malformed_tenant_is_refused_without_reading_metadata(metadata: FakeMetadata, tenant_id: str) -> None:
    refused("installed_tool_unavailable", tenant_id=tenant_id)
    assert metadata.calls == []


def test_actual_profile_is_unqualified_and_refuses_before_reading_metadata(metadata: FakeMetadata) -> None:
    assert gmail_read_policy.QUALIFIED_GMAIL_ARTIFACT is None
    assert gmail_read_policy.QUALIFIED_GMAIL_SCHEMA_DIGEST is None
    assert gmail_read_policy.GMAIL_SOURCE_AUDIT_REVISION is None
    refused("unsupported_action")
    assert metadata.calls == []


@pytest.mark.usefixtures("synthetic_qualified")
def test_synthetic_profile_binds_exact_installed_metadata(metadata: FakeMetadata) -> None:
    binding = real_call_metadata.resolve_installed_get_message(tenant_id=TENANT, provider_id=PROVIDER)
    assert binding.model_dump() == {
        "tenant_id": TENANT,
        "installation_id": "installation-1",
        "plugin_id": PLUGIN,
        "provider_id": PROVIDER,
        "tool_name": "get_message",
        "unique_identifier": SYNTHETIC_ARTIFACT,
        "version": SYNTHETIC_VERSION,
        "checksum": SYNTHETIC_CHECKSUM,
        "schema_digest": SYNTHETIC_SCHEMA,
        "source_audit_revision": SYNTHETIC_AUDIT,
        "daemon_contract_revision": "confirmed-tenant-dispatch-v1",
        "runtime_type": "local",
    }
    assert metadata.calls == [("installations", (TENANT, (PLUGIN,))), ("provider", (TENANT, PROVIDER))]


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize("provider_id", ["dify-gmail", "langgenius/dify-gmail/other", "other/dify-gmail/dify-gmail"])
def test_other_provider_is_unsupported_without_reading_metadata(metadata: FakeMetadata, provider_id: str) -> None:
    refused("unsupported_action", provider_id=provider_id)
    assert metadata.calls == []


STALE_INSTALLATIONS: list[dict[str, object]] = [
    # Checksum/version disagree with the qualified artifact or with its own identifier.
    {"checksum": "e" * 64},
    {"checksum": "e" * 64, "plugin_unique_identifier": f"{PLUGIN}:{SYNTHETIC_VERSION}@{'e' * 64}"},
    {"version": "9.9.8"},
    {"version": "9.9.8", "plugin_unique_identifier": f"{PLUGIN}:9.9.8@{SYNTHETIC_CHECKSUM}"},
    # Remote debugging and non-local runtimes are outside the local-only contract.
    {"source": "remote"},
    {"runtime_type": "remote"},
    {"runtime_type": "serverless"},
]


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize("change", STALE_INSTALLATIONS)
def test_stale_installation_is_refused(metadata: FakeMetadata, change: dict[str, object]) -> None:
    metadata.installations = [installation(**change)]
    # The provider agrees with its installation, so only the stale field can refuse.
    metadata.provider = provider_entity(
        unique_identifier=str(change.get("plugin_unique_identifier", SYNTHETIC_ARTIFACT))
    )
    refused("unsupported_action")


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize(
    "tool",
    [
        tool_declaration(parameters=[]),
        tool_declaration(description={"human": I18N, "llm": "Read and label one message"}),
        tool_declaration(output_schema={"type": "object"}),
    ],
)
def test_stale_tool_schema_is_refused(metadata: FakeMetadata, tool: dict[str, object]) -> None:
    metadata.provider = provider_entity(tools=[tool])
    refused("unsupported_action")


@pytest.mark.usefixtures("synthetic_qualified")
def test_dynamic_runtime_parameters_are_refused(metadata: FakeMetadata) -> None:
    metadata.provider = provider_entity(tools=[tool_declaration(has_runtime_parameters=True)])
    refused("unsupported_action")


@pytest.mark.usefixtures("synthetic_qualified")
def test_provider_artifact_disagreeing_with_installation_is_unavailable(metadata: FakeMetadata) -> None:
    metadata.provider = provider_entity(unique_identifier=f"{PLUGIN}:9.9.8@{SYNTHETIC_CHECKSUM}")
    refused("installed_tool_unavailable")


MISSING_METADATA: list[str] = [
    "no_installation",
    "foreign_tenant_installation",
    "other_plugin_installation",
    "duplicate_installation",
    "no_tool",
    "other_tool_only",
    "duplicate_tool",
    "provider_identity",
    "provider_plugin",
]


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize("case", MISSING_METADATA)
def test_missing_or_inconsistent_metadata_is_refused_not_empty_success(metadata: FakeMetadata, case: str) -> None:
    if case == "no_installation":
        metadata.installations = []
    elif case == "foreign_tenant_installation":
        metadata.installations = [installation(tenant_id="tenant-2")]
    elif case == "other_plugin_installation":
        metadata.installations = [installation(plugin_id="langgenius/other")]
    elif case == "duplicate_installation":
        metadata.installations = [installation(), installation(id="installation-2")]
    elif case == "no_tool":
        metadata.provider = provider_entity(tools=[])
    elif case == "other_tool_only":
        identity = {"author": "langgenius", "name": "send_message", "label": I18N, "provider": PROVIDER}
        metadata.provider = provider_entity(tools=[tool_declaration(identity=identity)])
    elif case == "duplicate_tool":
        metadata.provider = provider_entity(tools=[tool_declaration(), tool_declaration()])
    elif case == "provider_identity":
        entity = provider_entity()
        entity.declaration.identity.name = "langgenius/dify-gmail/other"
        metadata.provider = entity
    else:
        metadata.provider = provider_entity(plugin_id="langgenius/other")
    refused("installed_tool_unavailable")


@pytest.mark.usefixtures("synthetic_qualified")
@pytest.mark.parametrize("failing", ["installations", "provider"])
def test_metadata_transport_failure_is_sanitized(metadata: FakeMetadata, failing: str) -> None:
    error = ValueError("daemon said: secret-token-text")
    if failing == "installations":
        metadata.installations = error
    else:
        metadata.provider = error
    refusal = refused("installed_tool_unavailable")
    assert "secret-token-text" not in str(refusal)
    assert refusal.__cause__ is None
