"""Shared dispatch guard for the two Dify tool transport owners.

One provider operation has one quota even when exposed with several aliases,
credentials or transport routes. The strictest configured limit applies to
all of its declarations, including otherwise unlimited duplicates. Toolsets
filter exhausted operations during preparation and still reserve at dispatch
because a single model response can already contain several parallel calls.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Mapping

from pydantic import JsonValue
from pydantic_ai import RunContext, ToolReturn

from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig
from dify_agent.layers.dify_plugin.configs import (
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolParameterType,
)
from dify_agent.protocol.tool_call_limits import (
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_EXECUTION_FAILED_METADATA_KEY,
    ToolCallLimitMetadata,
)
from dify_agent.runtime.context import Deps
from dify_agent.runtime.tool_call_limits import ToolCallReservation


type DifyToolConfig = DifyPluginToolConfig | DifyCoreToolConfig


def tool_identity(config: DifyToolConfig) -> str:
    """Return a stable provider-operation key without alias, version or credentials."""
    if isinstance(config, DifyPluginToolConfig):
        plugin_id = config.plugin_id.split(":", 1)[0].split("@", 1)[0]
        provider_type, provider_id = "plugin", f"{plugin_id}/{config.provider}"
    else:
        provider_type, provider_id = config.provider_type, config.provider_id
        if provider_type == "plugin" and "/" not in provider_id:
            provider_id = f"langgenius/{provider_id}/{provider_id}"
    # Match the API's persisted ToolProviderID aliases at the low-level RPC
    # boundary too. Installation versions and credentials never create quota.
    if provider_type == "plugin":
        parts = provider_id.split("/")
        if len(parts) == 3 and parts[0] == "langgenius" and parts[2] in {"jina", "siliconflow", "stepfun", "gitee_ai"}:
            provider_id = f"langgenius/{parts[2]}_tool/{parts[2]}"
    return json.dumps([provider_type, provider_id, config.tool_name], separators=(",", ":"))


def _configured_tools(deps: Deps) -> list[DifyToolConfig]:
    """Read already validated Dify declarations, including registered slot aliases."""
    result: list[DifyToolConfig] = []
    for entry in deps.layers.values():
        tools = entry["config"].get("tools")
        if isinstance(tools, list):
            for raw in tools:
                if isinstance(raw, dict) and "tool_name" in raw:
                    if "provider_type" in raw and "provider_id" in raw:
                        result.append(DifyCoreToolConfig.model_validate(raw))
                    elif "plugin_id" in raw and "provider" in raw:
                        result.append(DifyPluginToolConfig.model_validate(raw))
    return result


@dataclass(frozen=True, slots=True)
class ToolCallLimitGuard:
    identity: str
    limit: int

    @classmethod
    def for_tool(cls, deps: Deps, config: DifyToolConfig) -> ToolCallLimitGuard | None:
        """Derive one operation's strictest explicit limit before performing I/O."""
        identity = tool_identity(config)
        limits = [
            tool.max_calls_per_run
            for tool in [config, *_configured_tools(deps)]
            if tool_identity(tool) == identity and tool.max_calls_per_run is not None
        ]
        return cls(identity, min(limits)) if limits else None

    async def available(self, ctx: RunContext[Deps]) -> bool:
        """Read authoritative usage without reserving or changing run retention."""
        usage = await ctx.deps.tool_call_limit_store.usage(
            run_id=ctx.deps.run_id, tool_identity=self.identity, limit=self.limit
        )
        return usage.used < usage.limit

    async def reserve(self, ctx: RunContext[Deps]) -> ToolCallReservation:
        """After validation, atomically reserve once before the caller dispatches."""
        if ctx.tool_call_id is None:
            raise ValueError("Limited tools require a stable native tool call id")
        return await ctx.deps.tool_call_limit_store.reserve(
            run_id=ctx.deps.run_id,
            tool_identity=self.identity,
            tool_call_id=ctx.tool_call_id,
            limit=self.limit,
        )

    def result(self, reservation: ToolCallReservation, observation: str, *, failed: bool = False) -> ToolReturn:
        """Annotate an admitted dispatch, retaining failed attempts in quota usage.

        Only an admitted request can carry the execution-failed marker. Native
        tool errors are observations so the Agent can continue, but the marker
        preserves the real failure for runtime logs independently of model text.
        """
        if failed and not reservation.allowed:
            raise ValueError("An unexecuted tool request cannot have an execution failure")
        metadata = ToolCallLimitMetadata(
            tool_identity=self.identity,
            limit=reservation.limit,
            used=reservation.used,
            execution_status="executed" if reservation.allowed else "not_executed",
            reason=reservation.reason,
        )
        annotations: dict[str, object] = {TOOL_CALL_LIMIT_METADATA_KEY: metadata.model_dump(mode="json")}
        if failed:
            annotations[TOOL_EXECUTION_FAILED_METADATA_KEY] = True
        return ToolReturn(observation, metadata=annotations)

    def denied(self, reservation: ToolCallReservation) -> ToolReturn:
        """Return structured nonexecution feedback; never represent denial as a result."""
        explanation = (
            f"This tool’s call limit for the current run has been reached ({reservation.used}/{reservation.limit})."
            if reservation.reason == "call_limit_reached"
            else "This tool call was already reserved; its execution result is not confirmed."
        )
        result = self.result(reservation, "")
        result.return_value = {
            "execution_status": "not_executed",
            "tool_identity": self.identity,
            "limit": reservation.limit,
            "used": reservation.used,
            "reason": reservation.reason,
            "message": f"{explanation} The request was not executed. Continue using available results or other tools.",
        }
        return result


def validate_limited_tool_arguments(
    schema: dict[str, JsonValue],
    parameters: list[DifyPluginToolParameter],
    runtime_parameters: Mapping[str, object],
    tool_arguments: Mapping[str, object],
    *,
    prepared_arguments: Mapping[str, object] | None = None,
) -> None:
    """Validate effective model-visible values before reserving a dispatch slot.

    Preconditions: the transport owner prepares defaults and casts using its
    existing invocation rules. Plugin owners preserve model-facing file locator
    shapes instead of daemon wire objects in ``prepared_arguments``. Without a
    prepared mapping, only defaults and the plugin's argument precedence apply.

    Hidden parameters are checked for presence but excluded from the model-facing
    schema, including ``additionalProperties: false``. Model-supplied undeclared
    fields remain subject to that schema. The input mappings remain unchanged.
    Invalid schemas, references or values raise ValueError without retrieving a
    remote resource, consuming quota or invoking the provider.
    """
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError
    from referencing import Registry
    from referencing.exceptions import Unresolvable

    supplied = {**runtime_parameters, **tool_arguments}
    effective = (
        prepared_arguments
        if prepared_arguments is not None
        else {
            **{parameter.name: parameter.default for parameter in parameters if parameter.default is not None},
            **supplied,
        }
    )
    missing = [parameter.name for parameter in parameters if parameter.required and parameter.name not in effective]
    if missing:
        raise ValueError(f"tool parameters not found: {', '.join(sorted(missing))}")
    hidden = {parameter.name for parameter in parameters if parameter.form is not DifyPluginToolParameterForm.LLM}
    properties = schema.get("properties")
    schema_fields = set(properties) if isinstance(properties, dict) else set()
    visible = schema_fields | {
        parameter.name for parameter in parameters if parameter.form is DifyPluginToolParameterForm.LLM
    }
    validation_arguments = {
        **{name: value for name, value in tool_arguments.items() if name not in hidden},
        **{name: value for name, value in effective.items() if name in visible and name not in hidden},
    }
    try:
        Draft202012Validator.check_schema(schema)
        # An empty registry rejects retrieval, including remote tool-supplied $ref URLs.
        validator = Draft202012Validator(schema, registry=Registry())
        first_error = next(validator.iter_errors(validation_arguments), None)
    except Unresolvable as exc:
        raise ValueError("Tool parameter schema contains an unresolved reference") from exc
    except SchemaError as exc:
        raise ValueError("Tool parameter schema is invalid") from exc
    if first_error is not None:
        raise ValueError(first_error.message)


def prepare_core_tool_validation_arguments(
    schema: dict[str, JsonValue],
    parameters: list[DifyPluginToolParameter],
    runtime_parameters: Mapping[str, object],
    tool_arguments: Mapping[str, object],
) -> dict[str, object]:
    """Project API Tool.invoke's effective values without provider or file I/O.

    The API's existing Tool.invoke makes runtime inputs authoritative and casts
    declared values before its provider executes. This projection mirrors those
    scalar/collection casts and includes declaration defaults for validation; the
    actual API request is unchanged and remains the invocation owner. The schema
    identifies multiple-select declarations, whose flag is absent from the older
    prepared-parameter DTO. Invalid conversions raise before quota reservation.
    """
    effective = {**tool_arguments, **runtime_parameters}
    properties = schema.get("properties")
    for parameter in parameters:
        if parameter.name not in effective and parameter.default is not None:
            effective[parameter.name] = parameter.default
        if parameter.name in effective:
            property_schema = properties.get(parameter.name) if isinstance(properties, dict) else None
            multiple = (
                parameter.type in {DifyPluginToolParameterType.SELECT, DifyPluginToolParameterType.DYNAMIC_SELECT}
                and isinstance(property_schema, dict)
                and property_schema.get("type") == "array"
            )
            effective[parameter.name] = _cast_core_validation_value(
                parameter.type, effective[parameter.name], multiple=multiple
            )
            if multiple and parameter.required and not effective[parameter.name]:
                raise ValueError(f"tool parameter {parameter.name} not found in tool config")
    return effective


def _cast_core_validation_value(
    parameter_type: DifyPluginToolParameterType, value: object, *, multiple: bool
) -> object:
    """Mirror the API's declared value conversions without changing dispatch data."""
    if multiple:
        values = (
            [item.strip() for item in value.split(",") if item.strip()]
            if isinstance(value, str)
            else []
            if value is None
            else value
        )
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            raise ValueError("Multiple-select tool parameters must contain only strings")
        return values
    match parameter_type:
        case (
            DifyPluginToolParameterType.STRING
            | DifyPluginToolParameterType.SECRET_INPUT
            | DifyPluginToolParameterType.SELECT
            | DifyPluginToolParameterType.CHECKBOX
            | DifyPluginToolParameterType.DYNAMIC_SELECT
        ):
            return "" if value is None else value if isinstance(value, str) else str(value)
        case DifyPluginToolParameterType.BOOLEAN:
            if isinstance(value, str) and value.lower() in {"false", "no", "n", "0"}:
                return False
            return bool(value)
        case DifyPluginToolParameterType.NUMBER:
            if isinstance(value, int | float):
                return value
            if isinstance(value, str) and value:
                return float(value) if "." in value else int(value)
            return None
        case DifyPluginToolParameterType.FILE:
            if isinstance(value, list):
                if len(value) != 1:
                    raise ValueError("This parameter only accepts one file but got multiple files while invoking.")
                return value[0]
            return value
        case DifyPluginToolParameterType.SYSTEM_FILES | DifyPluginToolParameterType.FILES:
            return value if isinstance(value, list) else [value]
        case DifyPluginToolParameterType.MODEL_SELECTOR | DifyPluginToolParameterType.APP_SELECTOR:
            if not isinstance(value, dict):
                raise ValueError("The selector must be a dictionary.")
            return value
        case DifyPluginToolParameterType.ARRAY:
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return parsed
            return [value]
        case DifyPluginToolParameterType.OBJECT:
            if isinstance(value, dict):
                return value
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, dict):
                    return parsed
            return {}
        case DifyPluginToolParameterType.ANY:
            return value
    raise ValueError(f"Unsupported tool parameter type: {parameter_type}")
