import json
import logging
import re
from collections.abc import Sequence

import json_repair

from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.workflow.generator.prompts.builder_prompts import BUILDER_SYSTEM_PROMPT, BUILDER_USER_PROMPT
from core.workflow.generator.prompts.planner_prompts import (
    PLANNER_SYSTEM_PROMPT,
    PLANNER_USER_PROMPT,
    format_tools_for_planner,
)
from core.workflow.generator.prompts.vibe_prompts import (
    format_available_models,
    format_available_nodes,
    format_available_tools,
    parse_vibe_response,
)
from core.workflow.generator.utils.edge_repair import EdgeRepair
from core.workflow.generator.utils.mermaid_generator import generate_mermaid
from core.workflow.generator.utils.node_repair import NodeRepair
from core.workflow.generator.utils.workflow_validator import WorkflowValidator

logger = logging.getLogger(__name__)


class WorkflowGenerator:
    """
    Refactored Vibe Workflow Generator (Planner-Builder Architecture).
    Extracts Vibe logic from the monolithic LLMGenerator.
    """

    @classmethod
    def generate_workflow_flowchart(
        cls,
        tenant_id: str,
        instruction: str,
        model_config: dict,
        available_nodes: Sequence[dict[str, object]] | None = None,
        existing_nodes: Sequence[dict[str, object]] | None = None,
        available_tools: Sequence[dict[str, object]] | None = None,
        selected_node_ids: Sequence[str] | None = None,
        previous_workflow: dict[str, object] | None = None,
        regenerate_mode: bool = False,
        preferred_language: str | None = None,
        available_models: Sequence[dict[str, object]] | None = None,
    ):
        """
        Generates a Dify Workflow Flowchart from natural language instruction.

        Pipeline:
        1. Planner: Analyze intent & select tools.
        2. Context Filter: Filter relevant tools (reduce tokens).
        3. Builder: Generate node configurations.
        4. Repair: Fix common node/edge issues (NodeRepair, EdgeRepair).
        5. Validator: Check for errors & generate friendly hints.
        6. Renderer: Deterministic Mermaid generation.
        """
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )
        model_parameters = model_config.get("completion_params", {})
        available_tools_list = list(available_tools) if available_tools else []

        # --- STEP 1: PLANNER ---
        planner_tools_context = format_tools_for_planner(available_tools_list)
        planner_system = PLANNER_SYSTEM_PROMPT.format(tools_summary=planner_tools_context)
        planner_user = PLANNER_USER_PROMPT.format(instruction=instruction)

        try:
            response = model_instance.invoke_llm(
                prompt_messages=[SystemPromptMessage(content=planner_system), UserPromptMessage(content=planner_user)],
                model_parameters=model_parameters,
                stream=False,
            )
            plan_content = response.message.content
            # Reuse parse_vibe_response logic or simple load
            plan_data = parse_vibe_response(plan_content)
        except Exception as e:
            logger.exception("Planner failed")
            return {"intent": "error", "error": f"Planning failed: {str(e)}"}

        if plan_data.get("intent") == "off_topic":
            return {
                "intent": "off_topic",
                "message": plan_data.get("message", "I can only help with workflow creation."),
                "suggestions": plan_data.get("suggestions", []),
            }

        # --- STEP 2: CONTEXT FILTERING ---
        required_tools = plan_data.get("required_tool_keys", [])

        filtered_tools = []
        if required_tools:
            # Simple linear search (optimized version would use a map)
            for tool in available_tools_list:
                t_key = tool.get("tool_key") or tool.get("tool_name")
                provider = tool.get("provider_id") or tool.get("provider")
                full_key = f"{provider}/{t_key}" if provider else t_key

                # Check if this tool is in required list (match either full key or short name)
                if t_key in required_tools or full_key in required_tools:
                    filtered_tools.append(tool)
        else:
            # If logic only, no tools needed
            filtered_tools = []

        # --- STEP 3: BUILDER ---
        # Prepare context
        tool_schemas = format_available_tools(filtered_tools)
        # We need to construct a fake list structure for builtin nodes formatting if using format_available_nodes
        # Actually format_available_nodes takes None to use defaults, or a list to add custom
        # But we want to SHOW the builtins. format_available_nodes internally uses BUILTIN_NODE_SCHEMAS.
        node_specs = format_available_nodes([])

        builder_system = BUILDER_SYSTEM_PROMPT.format(
            plan_context=json.dumps(plan_data.get("steps", []), indent=2),
            tool_schemas=tool_schemas,
            builtin_node_specs=node_specs,
            available_models=format_available_models(list(available_models or [])),
            preferred_language=preferred_language or "English",
        )
        builder_user = BUILDER_USER_PROMPT.format(instruction=instruction)

        try:
            build_res = model_instance.invoke_llm(
                prompt_messages=[SystemPromptMessage(content=builder_system), UserPromptMessage(content=builder_user)],
                model_parameters=model_parameters,
                stream=False,
            )
            # Builder output is raw JSON nodes/edges
            build_content = build_res.message.content
            match = re.search(r"```(?:json)?\s*([\s\S]+?)```", build_content)
            if match:
                build_content = match.group(1)

            workflow_data = json_repair.loads(build_content)

            if "nodes" not in workflow_data:
                workflow_data["nodes"] = []
            if "edges" not in workflow_data:
                workflow_data["edges"] = []

        except Exception as e:
            logger.exception("Builder failed")
            return {"intent": "error", "error": f"Building failed: {str(e)}"}

        # --- STEP 3.4: NODE REPAIR ---
        node_repair_result = NodeRepair.repair(workflow_data["nodes"])
        workflow_data["nodes"] = node_repair_result.nodes

        # --- STEP 3.5: EDGE REPAIR ---
        repair_result = EdgeRepair.repair(workflow_data)
        workflow_data = {
            "nodes": repair_result.nodes,
            "edges": repair_result.edges,
        }

        # --- STEP 4: VALIDATOR ---
        is_valid, hints = WorkflowValidator.validate(workflow_data, available_tools_list)

        # --- STEP 5: RENDERER ---
        mermaid_code = generate_mermaid(workflow_data)

        # --- FINALIZE ---
        # Combine validation hints with repair warnings
        all_warnings = [h.message for h in hints] + repair_result.warnings + node_repair_result.warnings

        # Add stability warning (as requested by user)
        stability_warning = "The generated workflow may require debugging."
        if preferred_language and preferred_language.startswith("zh"):
            stability_warning = "生成的 Workflow 可能需要调试。"
        all_warnings.append(stability_warning)

        all_fixes = repair_result.repairs_made + node_repair_result.repairs_made

        return {
            "intent": "generate",
            "flowchart": mermaid_code,
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "message": plan_data.get("plan_thought", "Generated workflow based on your request."),
            "warnings": all_warnings,
            "tool_recommendations": [],  # Legacy field
            "error": "",
            "fixed_issues": all_fixes,  # Track what was auto-fixed
        }
