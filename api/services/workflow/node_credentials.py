"""Publish's per-node credential rules (WorkflowService._validate_workflow_credentials), one node at a time."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final

from sqlalchemy.orm import Session

from core.entities import PluginCredentialType
from core.helper.credential_utils import check_credential_policy_compliance
from core.workflow.llm_environment_variable import (
    LLMEnvironmentVariable,
    parse_llm_model_selector,
    resolve_llm_model_config,
    should_resolve_llm_model_selector,
)
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.llm.entities import ModelConfig
from graphon.variables import VariableBase
from services.workflow_service import WorkflowService


@dataclass(frozen=True)
class _NodeCheck:
    service: WorkflowService
    workspace_id: str
    node_id: str
    data: Mapping[str, Any]
    environment: Mapping[str, VariableBase]
    session: Session


def _check_tool_credential(check: _NodeCheck, provider: str, credential_id: str | None) -> None:
    if credential_id:
        check_credential_policy_compliance(
            credential_id=credential_id, provider=provider, credential_type=PluginCredentialType.TOOL
        )
    else:
        check.service._check_default_tool_credential(check.workspace_id, provider, session=check.session)


def _check_load_balancing(check: _NodeCheck, model_config: Mapping[str, Any]) -> None:
    provider = model_config.get("provider")
    model_name = model_config.get("name")
    if not provider or not model_name:
        return
    if not check.service._is_load_balancing_enabled(check.workspace_id, provider, model_name):
        return
    configs = check.service._get_load_balancing_configs(check.workspace_id, provider, model_name, session=check.session)
    try:
        for config in configs:
            if config.get("credential_id"):
                check_credential_policy_compliance(config["credential_id"], provider, PluginCredentialType.MODEL)
    except Exception as e:
        raise ValueError(f"Invalid load balancing credentials for {provider}/{model_name}: {str(e)}") from e


def _check_tool_node(check: _NodeCheck) -> None:
    provider = check.data.get("provider_id")
    if provider:
        _check_tool_credential(check, provider, check.data.get("credential_id"))


def _check_agent_node(check: _NodeCheck) -> None:
    agent_params = check.data.get("agent_parameters", {})
    model_config = agent_params.get("model", {}).get("value", {})
    if model_config.get("provider") and model_config.get("model"):
        check.service._validate_llm_model_config(check.workspace_id, model_config["provider"], model_config["model"])
        _check_load_balancing(check, model_config)
    # Agent tools store their provider in provider_name
    for tool in agent_params.get("tools", {}).get("value", []):
        provider = tool.get("provider_name")
        if provider:
            _check_tool_credential(check, provider, tool.get("credential_id"))


def _check_llm_node(check: _NodeCheck) -> None:
    model_config = check.data.get("model", {})
    if should_resolve_llm_model_selector(check.data.get("model_selector")):
        selector = parse_llm_model_selector(check.data["model_selector"])
        variable = check.environment.get(selector[1])
        if not isinstance(variable, LLMEnvironmentVariable):
            raise ValueError(f"LLM environment variable '{selector[1]}' was not found or is not an LLM variable")
        resolved_model = resolve_llm_model_config(
            node_model=ModelConfig.model_validate(model_config),
            variable_name=selector[1],
            variable_value=variable.value,
        )
        model_config = resolved_model.model_dump(mode="json")
    provider = model_config.get("provider")
    model_name = model_config.get("name")
    if not (provider and model_name):
        raise ValueError(f"Node {check.node_id} ({BuiltinNodeTypes.LLM}): Missing provider or model configuration")
    check.service._validate_llm_model_config(check.workspace_id, provider, model_name)
    _check_load_balancing(check, model_config)


_NODE_CHECKS: Final[Mapping[str, Callable[[_NodeCheck], None]]] = {
    BuiltinNodeTypes.TOOL: _check_tool_node,
    BuiltinNodeTypes.AGENT: _check_agent_node,
    BuiltinNodeTypes.LLM: _check_llm_node,
}


def check_node_credentials(
    workspace_id: str, node: Mapping[str, Any], environment: Mapping[str, VariableBase], *, session: Session
) -> None:
    """Raises ValueError naming the node when a credential it needs is unusable; other node types pass."""
    data = node.get("data", {})
    node_type = data.get("type")
    node_id = node.get("id", "unknown")
    node_check = _NODE_CHECKS.get(node_type)
    if node_check is None:
        return
    try:
        node_check(_NodeCheck(WorkflowService(), workspace_id, node_id, data, environment, session))
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Node {node_id} ({node_type}): {str(e)}") from e
