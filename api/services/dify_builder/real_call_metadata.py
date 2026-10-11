"""Authoritative installed metadata for the one real-call Builder action.

Reads the plugin daemon's installation and tool declaration owners outside any
database transaction, binds them into an ``InstalledToolBinding`` and checks it
against the audited Gmail profile. While that profile is unqualified (its
constants are ``None``) this refuses before any read. Missing, inconsistent or
stale metadata refuses; it never yields an empty success.

``source_audit_revision`` and ``daemon_contract_revision`` name the reviewed
audit and the dispatch contract this binding requires. They are not evidence
that a daemon implementing that contract is deployed; that stays a separately
reviewed rollout gate.
"""

from collections.abc import Sequence

from pydantic import ValidationError

from core.dify_builder import gmail_read_policy
from core.dify_builder.execution_policy import BuilderExecutionPolicyError, canonical_digest
from core.dify_builder.real_call_consent import InstalledToolBinding
from core.plugin.entities.plugin import PluginInstallation, PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.tool_entities import ToolEntity


def get_message_schema_digest(tool: ToolEntity) -> str:
    """Digest of the full normalized tool declaration as the daemon reports it."""
    return canonical_digest(tool.model_dump(mode="json"))


def _read(tenant_id: str, provider_id: str) -> tuple[Sequence[PluginInstallation], PluginToolProviderEntity]:
    try:
        installations = PluginInstaller().fetch_plugin_installation_by_ids(
            tenant_id, [gmail_read_policy.GMAIL_PLUGIN_ID]
        )
        provider = PluginToolManager().fetch_tool_provider(tenant_id, provider_id)
    except Exception:
        # Transport/parse text may echo daemon or provider data; refuse without it.
        raise BuilderExecutionPolicyError("installed_tool_unavailable") from None
    return installations, provider


def resolve_installed_get_message(*, tenant_id: str, provider_id: str) -> InstalledToolBinding:
    """Bind the tenant's installed Gmail ``get_message`` exactly, or refuse."""
    if provider_id != gmail_read_policy.GMAIL_PROVIDER_ID:
        raise BuilderExecutionPolicyError("unsupported_action")
    if not isinstance(tenant_id, str) or not 1 <= len(tenant_id) <= 128:
        raise BuilderExecutionPolicyError("installed_tool_unavailable")
    audit_revision = gmail_read_policy.GMAIL_SOURCE_AUDIT_REVISION
    if (
        gmail_read_policy.QUALIFIED_GMAIL_ARTIFACT is None
        or gmail_read_policy.QUALIFIED_GMAIL_SCHEMA_DIGEST is None
        or audit_revision is None
    ):
        raise BuilderExecutionPolicyError("unsupported_action")

    installations, provider = _read(tenant_id, provider_id)
    if (
        len(installations) != 1
        or installations[0].tenant_id != tenant_id
        or installations[0].plugin_id != gmail_read_policy.GMAIL_PLUGIN_ID
    ):
        raise BuilderExecutionPolicyError("installed_tool_unavailable")
    installation = installations[0]
    if (
        provider.plugin_id != installation.plugin_id
        or provider.declaration.identity.name != provider_id
        or provider.plugin_unique_identifier != installation.plugin_unique_identifier
    ):
        raise BuilderExecutionPolicyError("installed_tool_unavailable")
    tools = [tool for tool in provider.declaration.tools if tool.identity.name == gmail_read_policy.GET_MESSAGE_TOOL]
    if len(tools) != 1:
        raise BuilderExecutionPolicyError("installed_tool_unavailable")
    tool = tools[0]

    # Local runtime only: no remote debugging, serverless or dynamic schema.
    if (
        installation.runtime_type != "local"
        or installation.source == PluginInstallationSource.Remote
        or tool.has_runtime_parameters
    ):
        raise BuilderExecutionPolicyError("unsupported_action")
    try:
        installed = InstalledToolBinding(
            tenant_id=tenant_id,
            installation_id=installation.id,
            plugin_id=installation.plugin_id,
            provider_id=provider_id,
            tool_name=tool.identity.name,
            unique_identifier=installation.plugin_unique_identifier,
            version=installation.version,
            checksum=installation.checksum,
            schema_digest=get_message_schema_digest(tool),
            source_audit_revision=audit_revision,
            daemon_contract_revision=gmail_read_policy.DAEMON_CONTRACT_REVISION,
            runtime_type="local",
        )
    except (ValidationError, BuilderExecutionPolicyError):
        raise BuilderExecutionPolicyError("installed_tool_unavailable") from None
    gmail_read_policy.qualify_installed_action(installed)
    return installed
