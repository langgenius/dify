"""Read-only tenant resource inventory for Dify Builder cognition/grounding.

One entry point -- list_tenant_resources -- returns the tenant's configured
models and datasets and every INSTALLED tool, normalized to id+label. A tool
is listed whether or not it is authorized; its ``readiness`` is metadata
readiness: whether a builtin credential row visible to the acting member
exists (or none is needed). Native API authorization remains unverified from
public bundles and is reported with an explicit note. Verified installed action schemas are eligible for Builder
planning, binding and generation even when setup is missing. Readiness is
computed from credential-row metadata only
(provider id, owner, visibility) -- never credential values, decryption,
OAuth refresh, validation or invocation. It is not live credential
validation, does not pin a ``credential_id``, and grants no runtime
authorization: native runtime credential selection and authorization still
decide whether the tool actually runs. Source unavailability is retained
separately from a successfully empty catalogue; neither installed metadata nor
configuration proves runtime health or a supplier lifecycle state.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.generator.tool_catalogue import ToolCatalogueEntry, build_tool_catalogue, tool_capability_text
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from models.dataset import Dataset
from models.provider_ids import ToolProviderID
from runtime_contracts.builder.execution import canonical_digest
from services.dify_builder import trace_diagnostics as diagnostics
from services.model_provider.service import ModelProviderService

logger = logging.getLogger(__name__)


# Appended to a missing_config tool's meta so the recommendation says why.
SETUP_REQUIRED_NOTE = "requires setup: authorize this tool's credentials in the workspace before it can run"
AUTHORIZATION_UNVERIFIED_NOTE = "requires setup: authorization could not be verified"


@dataclass(frozen=True)
class ResourceRef:
    id: str
    label: str
    meta: str = ""
    readiness: str = "ready"
    # Tools only: the tool's own description and its provider's label,
    # description and tags, used to rank tools against a request.
    description: str = ""
    capability: str = ""
    # Verified public declaration facts, for draft annotation/native selection.
    needs_credentials: bool = False
    plugin_id: str = ""
    # Internal Agent planning allowlist; no Soul prompt/defaults or credentials.
    agent_contract: dict[str, JsonValue] | None = None
    # Exact public identity fields, never inferred by splitting display labels.
    binding: dict[str, JsonValue] = field(default_factory=dict)
    availability: dict[str, str] = field(default_factory=dict)
    # Public declaration digest detects schema drift without carrying secrets.
    declaration_digest: str = ""
    # None means this source supplied no action parameter schema.
    parameter_contract: list[dict[str, JsonValue]] | None = None
    model_contract: dict[str, JsonValue] = field(default_factory=dict)


@dataclass(frozen=True)
class TenantResources:
    models: list[ResourceRef]
    datasets: list[ResourceRef]
    tools: list[ResourceRef]
    agents: list[ResourceRef] = field(default_factory=list)
    agent_source_error: str | None = None
    model_source_error: str | None = None
    tool_source_error: str | None = None


def _list_models(tenant_id: str) -> list[Any]:
    return ModelProviderService().get_models_by_model_type(tenant_id=tenant_id, model_type="llm")


def _list_datasets(tenant_id: str) -> list[Any]:
    with Session(db.engine) as session:
        return list(session.scalars(select(Dataset).where(Dataset.tenant_id == tenant_id)).all())


class _PartialToolInventoryError(Exception):
    def __init__(self, entries: list[ToolCatalogueEntry]) -> None:
        super().__init__("Workspace tool catalogue is incomplete")
        self.entries = entries


def _list_tools(tenant_id: str) -> list[ToolCatalogueEntry]:
    failures: list[str] = []
    entries = list(build_tool_catalogue(tenant_id, on_source_error=failures.append))
    if failures:
        raise _PartialToolInventoryError(entries)
    return entries


def _authorized_providers(tenant_id: str, account_id: str | None) -> set[str]:
    """Tool provider ids with a credential row the acting member may use.

    A provider is usable when it needs no credentials, or when a
    ``tool_builtin_providers`` row in this tenant is visible to the member
    under the native per-credential policy
    (``CredentialQuery``). ``account_id=None`` (no acting
    member) sees team-shared rows only, never a teammate's private or
    partial-member credential. Only the ``provider`` column is selected.

    Each row contributes its raw id (hardcoded providers such as ``time``
    and full plugin ids) plus its native ``ToolProviderID`` canonical form,
    which maps legacy short ids (``google`` -> ``langgenius/google/google``).
    Matching stays on the full id, so another organization's plugin with
    the same short provider name never borrows the authorization.
    """
    raw_providers = application_services().credential_queries.list_visible_tool_provider_ids(
        workspace_id=tenant_id,
        actor_id=account_id,
    )
    authorized: set[str] = set()
    for raw in raw_providers:
        authorized.add(raw)
        try:
            authorized.add(str(ToolProviderID(raw)))
        except ValueError:
            continue
    return authorized


def _tool_readiness(entry: ToolCatalogueEntry, authorized: set[str] | None) -> tuple[str, str]:
    """``(readiness, note)``: "ready" unless the tool needs credentials the
    acting member cannot use.

    ``authorized is None`` means the authorization lookup itself failed
    (see the ``build_tools`` try/except below). An unverified authorization
    is never reported ready: the tool stays discoverable as missing_config
    with a note saying it could not be verified. Runtime authorization
    remains the final gate either way.
    """
    # API authorization belongs to its native owner, never builtin credential
    # rows. Public metadata cannot prove authorization even for an API tool
    # that uses no credentials; keep it bindable with an honest setup note.
    if entry.get("provider_type") == "api" or entry.get("authorization_metadata") == "unverified":
        return "missing_config", AUTHORIZATION_UNVERIFIED_NOTE
    if not entry.get("needs_credentials"):
        return "ready", ""
    if authorized is None:
        return "missing_config", AUTHORIZATION_UNVERIFIED_NOTE
    if entry["provider_name"] in authorized:
        return "ready", ""
    return "missing_config", SETUP_REQUIRED_NOTE


def _tool_ref(entry: ToolCatalogueEntry, authorized: set[str] | None) -> ResourceRef:
    readiness, note = _tool_readiness(entry, authorized)
    description = str(entry.get("description") or "")
    # The readiness reason leads so a bounded rendering of a long description
    # (the discovery prompt line) never cuts it off.
    meta = f"{note} — {description}" if description and note else (note or description)
    return ResourceRef(
        id=f"{entry['provider_name']}/{entry['tool_name']}",
        label=str(entry.get("tool_label") or entry["tool_name"]),
        meta=meta,
        readiness=readiness,
        description=description,
        capability=tool_capability_text(entry),
        needs_credentials=entry.get("needs_credentials", False),
        plugin_id=entry.get("plugin_id", ""),
        binding={
            "provider_id": entry["provider_name"],
            "provider_name": entry["provider_name"],
            "tool_name": entry["tool_name"],
            "tool_label": str(entry.get("tool_label") or entry["tool_name"]),
            "provider_type": entry.get("provider_type", "builtin"),
            "plugin_unique_identifier": entry.get("plugin_unique_identifier", ""),
        },
        parameter_contract=[
            {
                "name": str(p.get("name") or ""),
                "form": str(p.get("form") or "llm"),
                "type": str(p.get("type") or ""),
                "required": p.get("required") is True,
                "has_default": p.get("default") is not None,
            }
            for p in entry["parameters"]
            if isinstance(p, dict)
        ]
        if "parameters" in entry
        else None,
        declaration_digest=canonical_digest(
            {
                "parameters": entry.get("parameters", []),
                "output_schema": entry.get("output_schema", {}),
            }
        ),
        availability={
            "catalogue": "installed",
            "configuration": "configured" if readiness == "ready" else "needs_setup",
            "runtime": "unverified",
            "lifecycle": "not_reported",
        },
    )


def _safe(build, source: str, errors: dict[str, str]) -> list:
    try:
        return build()
    except Exception as exc:  # a missing/mis-configured source degrades to empty, never raises
        diagnostics.report("inventory_unavailable", error=exc)
        errors[source] = "inventory_unavailable"
        logger.warning(
            "Dify Builder: resource source %r failed for the current tenant; retaining source availability as unknown",
            source,
            exc_info=True,
        )
        return [_tool_ref(entry, None) for entry in exc.entries] if isinstance(exc, _PartialToolInventoryError) else []


def list_tenant_resources(
    tenant_id: str, *, account_id: str | None = None, selected_agent_ids: frozenset[str] = frozenset()
) -> TenantResources:
    """``account_id`` is the acting member whose credential visibility decides
    tool readiness; ``None`` (no acting member) counts team-shared
    credentials only. Models and datasets do not depend on it.

    With selected_agent_ids, resolve only those confirmed identities through the
    same current eligibility/access filters; discovery otherwise stays bounded.
    """

    def build_models():
        models: list[ResourceRef] = []
        for prov in _list_models(tenant_id):
            for m in getattr(prov, "models", []):
                name = getattr(m, "model", "")
                if not name or getattr(m, "deprecated", False):
                    continue
                raw_status = getattr(m, "status", "unknown")
                status = str(getattr(raw_status, "value", raw_status))
                if status in {"disabled", "deprecated", "retired"}:
                    continue
                model_id = f"{prov.provider}/{name}"
                properties = getattr(m, "model_properties", {}) or {}
                raw_mode = properties.get("mode") if isinstance(properties, dict) else None
                mode = str(getattr(raw_mode, "value", raw_mode)) if raw_mode is not None else ""
                contract: dict[str, JsonValue] = {}
                if mode in {"chat", "completion"}:
                    contract["mode"] = mode
                raw_features = getattr(m, "features", None)
                if isinstance(raw_features, list):
                    contract["features"] = [str(getattr(feature, "value", feature)) for feature in raw_features]
                models.append(
                    ResourceRef(
                        id=model_id,
                        label=model_id,
                        readiness="ready" if status == "active" else "missing_config",
                        binding={"provider": str(prov.provider), "name": str(name)},
                        model_contract=contract,
                        availability={
                            "catalogue": "visible",
                            "configuration": "configured" if status == "active" else "unknown",
                            "runtime": "unverified",
                            "lifecycle": "not_reported",
                        },
                    )
                )
        return models

    def build_datasets():
        return [ResourceRef(id=str(d.id), label=str(d.name)) for d in _list_datasets(tenant_id)]

    def build_tools():
        tools = _list_tools(tenant_id)
        # Only pay for the authorization query when some listed tool would
        # actually be gated on it -- a tenant with no credentialed tools
        # installed never needs to touch tool_builtin_providers.
        authorized: set[str] | None = None
        if any(
            t.get("needs_credentials")
            and t.get("provider_type") != "api"
            and t.get("authorization_metadata") != "unverified"
            for t in tools
        ):
            try:
                authorized = _authorized_providers(tenant_id, account_id)
            except Exception as exc:  # the lookup degrades to "unknown", not "none authorized"
                logger.warning(
                    "Dify Builder: resource source %r failed for the current tenant; treating as empty",
                    "tool authorization",
                    exc_info=True,
                )
                diagnostics.report("authorization_lookup_failed", error=exc)
                authorized = None
        return [_tool_ref(t, authorized) for t in tools]

    source_errors: dict[str, str] = {}
    models = _safe(build_models, "models", source_errors)
    datasets = _safe(build_datasets, "datasets", source_errors)
    tools = _safe(build_tools, "tools", source_errors)
    agents: list[ResourceRef] = []
    agent_source_error = None
    if account_id is not None:
        try:
            from services.dify_builder.native_testing.agent_catalog import AgentCatalogService

            with Session(db.engine) as session:
                catalog = AgentCatalogService(session)
                if selected_agent_ids:
                    candidates = catalog.resolve_candidates(
                        tenant_id=tenant_id, actor_id=account_id, app_id=None, agent_ids=selected_agent_ids
                    )
                else:
                    candidates = catalog.list_candidates(
                        tenant_id=tenant_id, actor_id=account_id, app_id=None, query=None
                    )

            capability_sources = {
                "published_snapshot.summary": "published snapshot summary",
                "public_roster.description": "public roster description (no published summary)",
                "node_job_required": "no published capability summary",
            }
            agents = [
                ResourceRef(
                    id=item.resource_id,
                    label=item.name,
                    meta=(
                        f"Published version {item.display_version}; outputs must be declared by the node job. "
                        f"{SETUP_REQUIRED_NOTE if item.readiness == 'missing_config' else ''} "
                        f"{capability_sources[item.capability_source]}: "
                        f"{item.description}"
                    ),
                    readiness=item.readiness,
                    description=item.description,
                    capability=item.capability,
                    agent_contract={
                        "capability_source": item.capability_source,
                        "input_schema": item.input_schema,
                        "input_contract_source": item.input_contract_source,
                        "dependencies": list(item.dependencies),
                        "output_schema": item.output_schema,
                        "output_contract_source": item.output_contract_source,
                    },
                )
                for item in candidates
            ]
        except Exception as exc:
            diagnostics.report("inventory_unavailable", error=exc)
            # Preserve source unavailability separately from a successful empty
            # query, without exposing internal failure/configuration details.
            agent_source_error = "Published Agent catalog unavailable"
            logger.warning("Dify Builder: published Agent catalog unavailable")
    return TenantResources(
        models=models,
        datasets=datasets,
        tools=tools,
        agents=agents,
        agent_source_error=agent_source_error,
        model_source_error=source_errors.get("models"),
        tool_source_error=source_errors.get("tools"),
    )
