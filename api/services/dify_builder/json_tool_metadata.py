"""Exact installed metadata for the qualified JSON Process parse action.

The fixed qualifications describe reviewed administrator-installed runtimes,
not atomic leases on daemon bytes. Callers read metadata before and after dispatch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.impl.tool import PluginToolManager
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    QualifiedJsonToolBinding,
    canonical_digest,
)

if TYPE_CHECKING:
    from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
    from core.tools.entities.tool_entities import ToolEntity, ToolProviderEntityWithPlugin

PLUGIN_ID = "langgenius/json_process"
PROVIDER_ID = "langgenius/json_process/json_process"
NATIVE_PROVIDER_NAME = "json_process"
TOOL_NAME = "parse"
VERSION = "0.0.8"
CHECKSUM = "3333687ec0412e1f2a1798d632fc5f3187f36ebd4bf2432a599a96c74e92f503"
UNIQUE_IDENTIFIER = f"{PLUGIN_ID}:{VERSION}@{CHECKSUM}"
PROVIDER_SCHEMA_DIGEST = "90493459b7c95b78148c085cb33833c932c671f5e7296c0e7d8b050f2a6998a3"
TOOL_SCHEMA_DIGEST = "bf4897c1c2e3b3a04e9abc8bfdd4d7715abbd7bc5b2148ad4067b6b9fe11e449"
QUALIFICATION_REVISION = "local-json-process-0.0.8-sdk-0.10.2-jsonpath-ng-1.8.0-python-3.12.3-v1"
QUALIFICATION_DIGEST = canonical_digest(
    {
        "revision": QUALIFICATION_REVISION,
        "identifier": UNIQUE_IDENTIFIER,
        "provider_schema_digest": PROVIDER_SCHEMA_DIGEST,
        "tool_schema_digest": TOOL_SCHEMA_DIGEST,
        "archive_sha256": "a43cbcb37762c512285f0b9ce2a5eb239e205e0b3a2c0fa2d9dba23a5aff6944",
        "runtime_type": "local",
    }
)
SERVERLESS_QUALIFICATION_REVISION = "serverless-json-process-0.0.8-sdk-0.10.2-jsonpath-ng-1.8.0-python-3.12.14-v1"
SERVERLESS_QUALIFICATION_DIGEST = canonical_digest(
    {
        "revision": SERVERLESS_QUALIFICATION_REVISION,
        "identifier": UNIQUE_IDENTIFIER,
        "provider_schema_digest": PROVIDER_SCHEMA_DIGEST,
        "tool_schema_digest": TOOL_SCHEMA_DIGEST,
        "archive_sha256": "a43cbcb37762c512285f0b9ce2a5eb239e205e0b3a2c0fa2d9dba23a5aff6944",
        "runtime_type": "serverless",
    }
)


@dataclass(frozen=True, slots=True)
class InstalledJsonParse:
    tenant_id: str
    installation_id: str
    plugin_id: str
    provider_id: str
    tool_name: str
    unique_identifier: str
    version: str
    checksum: str
    provider_schema_digest: str
    tool_schema_digest: str
    runtime_type: str
    qualification_digest: str

    @property
    def binding_digest(self) -> str:
        return canonical_digest({field: getattr(self, field) for field in self.__dataclass_fields__})


def _validate_declaration(declaration: ToolProviderEntityWithPlugin) -> ToolEntity:
    """Validate the full normalized declaration before any native credential branch."""
    if (
        declaration.identity.name != PROVIDER_ID
        or declaration.plugin_id is not None
        or declaration.credentials_schema
        or declaration.oauth_schema is not None
        or canonical_digest(declaration.model_dump(mode="json")) != PROVIDER_SCHEMA_DIGEST
    ):
        raise BuilderExecutionPolicyError("unsupported_json_tool_installation")
    parses = [tool for tool in declaration.tools if tool.identity.name == TOOL_NAME]
    if len(parses) != 1:
        raise BuilderExecutionPolicyError("unsupported_json_tool_installation")
    parse = parses[0]
    if (
        parse.identity.provider != PROVIDER_ID
        or parse.has_runtime_parameters
        or parse.output_schema
        or canonical_digest(parse.model_dump(mode="json")) != TOOL_SCHEMA_DIGEST
    ):
        raise BuilderExecutionPolicyError("unsupported_json_tool_installation")
    return parse


def validate_current_json_controller(controller: object, tool: object, *, expected: InstalledJsonParse) -> None:
    """Check the exact controller/tool returned by ToolManager, including cached results."""
    from core.tools.plugin_tool.provider import PluginToolProviderController
    from core.tools.plugin_tool.tool import PluginTool

    if (
        type(controller) is not PluginToolProviderController
        or type(tool) is not PluginTool
        or controller.tenant_id != expected.tenant_id
        or controller.plugin_id != expected.plugin_id
        or controller.plugin_unique_identifier != expected.unique_identifier
        or controller.need_credentials
    ):
        raise BuilderExecutionPolicyError("json_tool_controller_mismatch")
    _validate_declaration(controller.entity)
    if (
        tool.entity.identity.name != TOOL_NAME
        or tool.entity.identity.provider != PROVIDER_ID
        or tool.plugin_unique_identifier != expected.unique_identifier
        or tool.tenant_id != expected.tenant_id
        or canonical_digest(tool.entity.model_dump(mode="json")) != TOOL_SCHEMA_DIGEST
    ):
        raise BuilderExecutionPolicyError("json_tool_controller_mismatch")


def resolve_installed_json_parse(*, tenant_id: str) -> InstalledJsonParse:
    """Read the installation and provider from their native owners, outside SQL."""
    if type(tenant_id) is not str or not 1 <= len(tenant_id) <= 128:
        raise BuilderExecutionPolicyError("installed_json_tool_unavailable")
    try:
        installations = PluginInstaller().fetch_plugin_installation_by_ids(tenant_id, [PLUGIN_ID])
        provider: PluginToolProviderEntity = PluginToolManager().fetch_tool_provider(tenant_id, PROVIDER_ID)
    except Exception:
        raise BuilderExecutionPolicyError("installed_json_tool_unavailable") from None
    try:
        if len(installations) != 1:
            raise BuilderExecutionPolicyError("installed_json_tool_unavailable")
        installation = installations[0]
        if (
            installation.tenant_id != tenant_id
            or installation.plugin_id != PLUGIN_ID
            or installation.plugin_unique_identifier != UNIQUE_IDENTIFIER
            or installation.version != VERSION
            or installation.checksum != CHECKSUM
            or installation.source != PluginInstallationSource.Marketplace
            or provider.provider != NATIVE_PROVIDER_NAME
            or provider.plugin_id != PLUGIN_ID
            or provider.plugin_unique_identifier != UNIQUE_IDENTIFIER
        ):
            raise BuilderExecutionPolicyError("unsupported_json_tool_installation")
        if installation.runtime_type == "local":
            qualification_digest = QUALIFICATION_DIGEST
        elif installation.runtime_type == "serverless":
            qualification_digest = SERVERLESS_QUALIFICATION_DIGEST
        else:
            raise BuilderExecutionPolicyError("unsupported_json_tool_installation")
        _validate_declaration(provider.declaration)
        return InstalledJsonParse(
            tenant_id=tenant_id,
            installation_id=installation.id,
            plugin_id=PLUGIN_ID,
            provider_id=PROVIDER_ID,
            tool_name=TOOL_NAME,
            unique_identifier=UNIQUE_IDENTIFIER,
            version=VERSION,
            checksum=CHECKSUM,
            provider_schema_digest=PROVIDER_SCHEMA_DIGEST,
            tool_schema_digest=TOOL_SCHEMA_DIGEST,
            runtime_type=installation.runtime_type,
            qualification_digest=qualification_digest,
        )
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        raise BuilderExecutionPolicyError("installed_json_tool_unavailable") from None


def require_same_json_installation(expected: QualifiedJsonToolBinding, actual: InstalledJsonParse) -> None:
    """Require the persisted expected identity to match this exact metadata read."""
    for field in (
        "tenant_id",
        "installation_id",
        "plugin_id",
        "provider_id",
        "tool_name",
        "unique_identifier",
        "version",
        "checksum",
        "provider_schema_digest",
        "tool_schema_digest",
        "runtime_type",
        "qualification_digest",
    ):
        if getattr(expected, field) != getattr(actual, field):
            raise BuilderExecutionPolicyError("json_tool_installation_changed")
