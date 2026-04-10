"""Virtual Workflow Synthesizer for transparent old-app upgrade.

Converts an old App's AppModelConfig into an in-memory Workflow object
with a single agent-v2 node, without persisting to the database.
This allows legacy apps (chat/completion/agent-chat) to run through
the Agent V2 workflow engine transparently.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from core.workflow.nodes.agent_v2.entities import AGENT_V2_NODE_TYPE
from models.model import App, AppMode, AppModelConfig

logger = logging.getLogger(__name__)


class VirtualWorkflowSynthesizer:
    """Synthesize in-memory Workflow from legacy AppModelConfig."""

    @staticmethod
    def synthesize(app: App) -> Any:
        """Convert old app config to a virtual Workflow object.

        Returns a Workflow-like object (not persisted to DB) that can be
        passed to AdvancedChatAppGenerator.generate().
        """
        from models.workflow import Workflow, WorkflowType

        config = app.app_model_config
        if not config:
            raise ValueError("App has no model config")

        model_dict = _extract_model_config(config)
        prompt_template = _build_prompt_template(config, app.mode)
        tools = _extract_tools(config)
        agent_strategy = _extract_strategy(config)
        max_iterations = _extract_max_iterations(config)
        context = _build_context_config(config)
        vision = _build_vision_config(config)
        is_chat = app.mode != AppMode.COMPLETION

        agent_node_data: dict[str, Any] = {
            "type": AGENT_V2_NODE_TYPE,
            "title": "Agent",
            "model": model_dict,
            "prompt_template": prompt_template,
            "tools": tools,
            "max_iterations": max_iterations,
            "agent_strategy": agent_strategy,
            "context": context,
            "vision": vision,
        }
        if is_chat:
            agent_node_data["memory"] = {"window": {"enabled": True, "size": 50}}

        graph = _build_graph(agent_node_data, is_chat)

        workflow = Workflow()
        workflow.id = str(uuid4())
        workflow.tenant_id = app.tenant_id
        workflow.app_id = app.id
        workflow.type = WorkflowType.CHAT if is_chat else WorkflowType.WORKFLOW
        workflow.version = "virtual"
        workflow.graph = json.dumps(graph)
        workflow.features = json.dumps(_build_features(config))
        workflow.created_by = app.created_by
        workflow.updated_by = app.updated_by

        return workflow

    @staticmethod
    def ensure_workflow(app: App) -> Any:
        """Ensure the old app has a workflow, creating one if needed.

        On first call for a legacy app, synthesizes a workflow from its
        AppModelConfig and persists it as a draft. On subsequent calls,
        returns the existing draft. This is a one-time lazy upgrade:
        the app gets a real workflow that can be edited in the workflow editor.

        The app's workflow_id is NOT updated (preserving its legacy state),
        but the workflow is findable via app_id + version="draft".
        """
        from models.workflow import Workflow

        from extensions.ext_database import db

        existing = db.session.query(Workflow).filter_by(
            app_id=app.id, version="draft"
        ).first()
        if existing:
            return existing

        workflow = VirtualWorkflowSynthesizer.synthesize(app)
        workflow.version = "draft"

        db.session.add(workflow)
        db.session.commit()
        logger.info("Created draft workflow %s for legacy app %s", workflow.id, app.id)
        return workflow


def _extract_model_config(config: AppModelConfig) -> dict[str, Any]:
    if config.model:
        try:
            return json.loads(config.model)
        except (json.JSONDecodeError, TypeError):
            pass
    return {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


def _build_prompt_template(config: AppModelConfig, mode: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []

    if config.prompt_type and config.prompt_type.value == "advanced":
        if config.chat_prompt_config:
            try:
                chat_config = json.loads(config.chat_prompt_config)
                if isinstance(chat_config, dict) and "prompt" in chat_config:
                    prompts = chat_config["prompt"]
                    if isinstance(prompts, list):
                        for p in prompts:
                            if isinstance(p, dict) and "role" in p and "text" in p:
                                messages.append({"role": p["role"], "text": p["text"]})
            except (json.JSONDecodeError, TypeError):
                pass

    if not messages:
        pre_prompt = config.pre_prompt or ""
        if pre_prompt:
            messages.append({"role": "system", "text": pre_prompt})

        if mode == AppMode.COMPLETION:
            messages.append({"role": "user", "text": "{{#sys.query#}}"})
        else:
            messages.append({"role": "user", "text": "{{#sys.query#}}"})

    return messages


def _extract_tools(config: AppModelConfig) -> list[dict[str, Any]]:
    if not config.agent_mode:
        return []
    try:
        agent_mode = json.loads(config.agent_mode) if isinstance(config.agent_mode, str) else config.agent_mode
    except (json.JSONDecodeError, TypeError):
        return []

    if not isinstance(agent_mode, dict) or not agent_mode.get("enabled"):
        return []

    tools_config = agent_mode.get("tools", [])
    result: list[dict[str, Any]] = []

    for tool in tools_config:
        if not isinstance(tool, dict):
            continue
        if not tool.get("enabled", True):
            continue

        provider_type = tool.get("provider_type", "builtin")
        provider_id = tool.get("provider_id", "")
        tool_name = tool.get("tool_name", "")

        if not tool_name:
            continue

        result.append({
            "enabled": True,
            "type": provider_type,
            "provider_name": provider_id,
            "tool_name": tool_name,
            "parameters": tool.get("tool_parameters", {}),
            "settings": {},
        })

    return result


def _extract_strategy(config: AppModelConfig) -> str:
    if not config.agent_mode:
        return "auto"
    try:
        agent_mode = json.loads(config.agent_mode) if isinstance(config.agent_mode, str) else config.agent_mode
    except (json.JSONDecodeError, TypeError):
        return "auto"

    strategy = agent_mode.get("strategy", "")
    mapping = {
        "function_call": "function-calling",
        "react": "chain-of-thought",
    }
    return mapping.get(strategy, "auto")


def _extract_max_iterations(config: AppModelConfig) -> int:
    if not config.agent_mode:
        return 10
    try:
        agent_mode = json.loads(config.agent_mode) if isinstance(config.agent_mode, str) else config.agent_mode
    except (json.JSONDecodeError, TypeError):
        return 10
    return agent_mode.get("max_iteration", 10)


def _build_context_config(config: AppModelConfig) -> dict[str, Any]:
    if config.dataset_configs:
        try:
            dc = json.loads(config.dataset_configs) if isinstance(config.dataset_configs, str) else config.dataset_configs
            if isinstance(dc, dict) and dc.get("datasets", {}).get("datasets", []):
                return {"enabled": True}
        except (json.JSONDecodeError, TypeError):
            pass
    return {"enabled": False}


def _build_vision_config(config: AppModelConfig) -> dict[str, Any]:
    if config.file_upload:
        try:
            fu = json.loads(config.file_upload) if isinstance(config.file_upload, str) else config.file_upload
            if isinstance(fu, dict) and fu.get("image", {}).get("enabled"):
                return {"enabled": True}
        except (json.JSONDecodeError, TypeError):
            pass
    return {"enabled": False}


def _build_graph(agent_data: dict[str, Any], is_chat: bool) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = [
        {
            "id": "start",
            "type": "custom",
            "data": {"type": "start", "title": "Start", "variables": []},
            "position": {"x": 80, "y": 282},
        },
        {
            "id": "agent",
            "type": "custom",
            "data": agent_data,
            "position": {"x": 400, "y": 282},
        },
    ]

    if is_chat:
        nodes.append({
            "id": "answer",
            "type": "custom",
            "data": {"type": "answer", "title": "Answer", "answer": "{{#agent.text#}}"},
            "position": {"x": 720, "y": 282},
        })
        end_id = "answer"
    else:
        nodes.append({
            "id": "end",
            "type": "custom",
            "data": {"type": "end", "title": "End", "outputs": [{"value_selector": ["agent", "text"], "variable": "result"}]},
            "position": {"x": 720, "y": 282},
        })
        end_id = "end"

    edges = [
        {"id": "start-agent", "source": "start", "target": "agent", "sourceHandle": "source", "targetHandle": "target"},
        {"id": f"agent-{end_id}", "source": "agent", "target": end_id, "sourceHandle": "source", "targetHandle": "target"},
    ]

    return {"nodes": nodes, "edges": edges}


def _build_features(config: AppModelConfig) -> dict[str, Any]:
    """Extract app-level features from AppModelConfig for the synthesized workflow."""
    features: dict[str, Any] = {}

    if config.opening_statement:
        features["opening_statement"] = config.opening_statement

    if config.suggested_questions:
        try:
            sq = json.loads(config.suggested_questions) if isinstance(config.suggested_questions, str) else config.suggested_questions
            if sq:
                features["suggested_questions"] = sq
        except (json.JSONDecodeError, TypeError):
            pass

    if config.sensitive_word_avoidance:
        try:
            swa = json.loads(config.sensitive_word_avoidance) if isinstance(config.sensitive_word_avoidance, str) else config.sensitive_word_avoidance
            if swa and swa.get("enabled"):
                features["sensitive_word_avoidance"] = swa
        except (json.JSONDecodeError, TypeError):
            pass

    if config.more_like_this:
        try:
            mlt = json.loads(config.more_like_this) if isinstance(config.more_like_this, str) else config.more_like_this
            if mlt and mlt.get("enabled"):
                features["more_like_this"] = mlt
        except (json.JSONDecodeError, TypeError):
            pass

    if config.speech_to_text:
        try:
            stt = json.loads(config.speech_to_text) if isinstance(config.speech_to_text, str) else config.speech_to_text
            if stt and stt.get("enabled"):
                features["speech_to_text"] = stt
        except (json.JSONDecodeError, TypeError):
            pass

    if config.text_to_speech:
        try:
            tts = json.loads(config.text_to_speech) if isinstance(config.text_to_speech, str) else config.text_to_speech
            if tts and tts.get("enabled"):
                features["text_to_speech"] = tts
        except (json.JSONDecodeError, TypeError):
            pass

    if config.retriever_resource:
        try:
            rr = json.loads(config.retriever_resource) if isinstance(config.retriever_resource, str) else config.retriever_resource
            if rr and rr.get("enabled"):
                features["retriever_resource"] = rr
        except (json.JSONDecodeError, TypeError):
            pass

    return features
