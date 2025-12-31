import json
import logging
import re
from collections.abc import Sequence

import json_repair

from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_SYSTEM_PROMPT,
    BUILDER_USER_PROMPT,
    format_existing_edges,
    format_existing_nodes,
    format_selected_nodes,
)
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
from core.workflow.generator.utils.mermaid_generator import generate_mermaid
from core.workflow.generator.utils.workflow_validator import ValidationHint, WorkflowValidator

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
        existing_edges: Sequence[dict[str, object]] | None = None,
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

        # Check if this is modification mode (user is refining existing workflow)
        has_existing_nodes = existing_nodes and len(list(existing_nodes)) > 0

        # --- STEP 1: PLANNER (Skip in modification mode) ---
        if has_existing_nodes:
            # In modification mode, skip Planner:
            # - User intent is clear: modify the existing workflow
            # - Tools are already in use (from existing nodes)
            # - No need for intent classification or tool selection
            plan_data = {"intent": "generate", "steps": [], "required_tool_keys": []}
            filtered_tools = available_tools_list  # Use all available tools
        else:
            # In creation mode, run Planner to validate intent and select tools
            planner_tools_context = format_tools_for_planner(available_tools_list)
            planner_system = PLANNER_SYSTEM_PROMPT.format(tools_summary=planner_tools_context)
            planner_user = PLANNER_USER_PROMPT.format(instruction=instruction)

            try:
                response = model_instance.invoke_llm(
                    prompt_messages=[
                        SystemPromptMessage(content=planner_system),
                        UserPromptMessage(content=planner_user),
                    ],
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

        # --- STEP 3: BUILDER (with retry loop) ---
        MAX_GLOBAL_RETRIES = 2  # Total attempts: 1 initial + 1 retry

        workflow_data = None
        mermaid_code = None
        all_warnings = []
        all_fixes = []
        retry_count = 0
        validation_hints = []

        for attempt in range(MAX_GLOBAL_RETRIES):
            retry_count = attempt
            logger.info("Generation attempt %s/%s", attempt + 1, MAX_GLOBAL_RETRIES)

            # Prepare context
            tool_schemas = format_available_tools(filtered_tools)
            node_specs = format_available_nodes(list(available_nodes) if available_nodes else [])
            existing_nodes_context = format_existing_nodes(list(existing_nodes) if existing_nodes else None)
            existing_edges_context = format_existing_edges(list(existing_edges) if existing_edges else None)
            selected_nodes_context = format_selected_nodes(
                list(selected_node_ids) if selected_node_ids else None, list(existing_nodes) if existing_nodes else None
            )

            # Build retry context
            retry_context = ""

            # NOTE: Manual regeneration/refinement mode removed
            # Only handle automatic retry (validation errors)

            # For automatic retry (validation errors)
            if attempt > 0 and validation_hints:
                severe_issues = [h for h in validation_hints if h.severity == "error"]
                if severe_issues:
                    retry_context = "\n<validation_feedback>\n"
                    retry_context += "The previous generation had validation errors:\n"
                    for idx, hint in enumerate(severe_issues[:5], 1):
                        retry_context += f"{idx}. {hint.message}\n"
                    retry_context += "\nPlease fix these specific issues while keeping everything else UNCHANGED.\n"
                    retry_context += "</validation_feedback>\n"

            builder_system = BUILDER_SYSTEM_PROMPT.format(
                plan_context=json.dumps(plan_data.get("steps", []), indent=2),
                tool_schemas=tool_schemas,
                builtin_node_specs=node_specs,
                available_models=format_available_models(list(available_models or [])),
                preferred_language=preferred_language or "English",
                existing_nodes_context=existing_nodes_context,
                existing_edges_context=existing_edges_context,
                selected_nodes_context=selected_nodes_context,
            )
            builder_user = BUILDER_USER_PROMPT.format(instruction=instruction) + retry_context

            try:
                build_res = model_instance.invoke_llm(
                    prompt_messages=[
                        SystemPromptMessage(content=builder_system),
                        UserPromptMessage(content=builder_user),
                    ],
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
                logger.exception("Builder failed on attempt %d", attempt + 1)
                if attempt == MAX_GLOBAL_RETRIES - 1:
                    return {"intent": "error", "error": f"Building failed: {str(e)}"}
                continue  # Try again

            # NOTE: NodeRepair and EdgeRepair have been removed.
            # Validation will detect structural issues, and LLM will fix them on retry.
            # This is more accurate because LLM understands the workflow context.

            # --- STEP 4: RENDERER (Generate Mermaid early for validation) ---
            mermaid_code = generate_mermaid(workflow_data)

            # --- STEP 5: VALIDATOR ---
            is_valid, validation_hints = WorkflowValidator.validate(workflow_data, available_tools_list)

            # --- STEP 6: GRAPH VALIDATION (structural checks using graph algorithms) ---
            if attempt < MAX_GLOBAL_RETRIES - 1:
                try:
                    from core.workflow.generator.utils.graph_validator import GraphValidator

                    graph_result = GraphValidator.validate(workflow_data)

                    if not graph_result.success:
                        # Convert graph errors to validation hints
                        for graph_error in graph_result.errors:
                            validation_hints.append(
                                ValidationHint(
                                    node_id=graph_error.node_id,
                                    field="edges",
                                    message=f"[Graph] {graph_error.message}",
                                    severity="error",
                                )
                            )
                        # Also add warnings (dead ends) as hints
                        for graph_warning in graph_result.warnings:
                            validation_hints.append(
                                ValidationHint(
                                    node_id=graph_warning.node_id,
                                    field="edges",
                                    message=f"[Graph] {graph_warning.message}",
                                    severity="warning",
                                )
                            )
                except Exception as e:
                    logger.warning("Graph validation error: %s", e)
            # Collect all validation warnings
            all_warnings = [h.message for h in validation_hints]

            # Check if we should retry
            severe_issues = [h for h in validation_hints if h.severity == "error"]

            if not severe_issues or attempt == MAX_GLOBAL_RETRIES - 1:
                break

            # Has severe errors and retries remaining - continue to next attempt

        # Collect all validation warnings
        all_warnings = [h.message for h in validation_hints]

        # Add stability warning (as requested by user)
        stability_warning = "The generated workflow may require debugging."
        if preferred_language and preferred_language.startswith("zh"):
            stability_warning = "生成的 Workflow 可能需要调试。"
        all_warnings.append(stability_warning)

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
            "retry_count": retry_count,  # Track how many retries were needed
        }
