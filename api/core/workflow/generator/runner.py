"""
Refactored Workflow Generator using enhanced components.

Pipeline:
1. Planner: Analyze intent & select tools (using enhanced Planner class)
2. Context Filter: Filter relevant tools (reduce tokens)
3. Builder: Generate node configurations (with retry strategy)
4. Graph Validator: Validate structural integrity (always)
5. Workflow Validator: Check business logic
6. Renderer: Generate Mermaid flowchart
"""

import json
import logging
from collections.abc import Sequence
from typing import Any

from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.workflow.generator.core.planner import Planner, PlannerOutput
from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_SYSTEM_PROMPT,
    BUILDER_USER_PROMPT,
    format_existing_edges,
    format_existing_nodes,
    format_selected_nodes,
)
from core.workflow.generator.prompts.vibe_prompts import (
    format_available_models,
    format_available_nodes,
    format_available_tools,
)
from core.workflow.generator.strategies.output_strategy import StructuredOutputStrategy, parse_structured_output
from core.workflow.generator.strategies.retry_strategy import RetryContext, RetryStrategy
from core.workflow.generator.types.constants import (
    INTENT_ERROR,
    INTENT_GENERATE,
    INTENT_OFF_TOPIC,
    MAX_RETRIES,
    STABILITY_WARNING_EN,
    STABILITY_WARNING_ZH,
)
from core.workflow.generator.types.errors import ErrorCode, ErrorType, WorkflowGenerationError
from core.workflow.generator.utils.graph_validator import GraphValidator
from core.workflow.generator.utils.mermaid_generator import generate_mermaid
from core.workflow.generator.utils.workflow_validator import ValidationHint, WorkflowValidator

logger = logging.getLogger(__name__)


class WorkflowGenerator:
    """
    Refactored Vibe Workflow Generator (Planner-Builder Architecture).

    Uses enhanced components:
    - Planner class for intent analysis and tool selection (not direct LLM call)
    - RetryStrategy for intelligent retry logic with temperature adjustment
    - StructuredOutputStrategy for detecting best LLM output method
    - GraphValidator for structural validation (always)
    - WorkflowGenerationError for structured error handling
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
    ) -> dict[str, Any]:
        """
        Generates a Dify Workflow Flowchart from natural language instruction.

        Pipeline:
        1. Planner: Analyze intent & select tools.
        2. Context Filter: Filter relevant tools (reduce tokens).
        3. Builder: Generate node configurations (with retry).
        4. Graph Validator: Validate structural integrity (always).
        5. Workflow Validator: Check business logic.
        6. Renderer: Deterministic Mermaid generation.

        Returns:
            dict with keys: intent, nodes, edges, flowchart, warnings, etc.
            On error: intent="error", error_code, error_type, is_retryable
        """
        try:
            return cls._generate_workflow_internal(
                tenant_id=tenant_id,
                instruction=instruction,
                model_config=model_config,
                available_nodes=available_nodes,
                existing_nodes=existing_nodes,
                existing_edges=existing_edges,
                available_tools=available_tools,
                selected_node_ids=selected_node_ids,
                previous_workflow=previous_workflow,
                regenerate_mode=regenerate_mode,
                preferred_language=preferred_language,
                available_models=available_models,
            )
        except Exception as e:
            logger.exception("Workflow generation failed with unexpected error")
            error = WorkflowGenerationError(
                type=ErrorType.GENERATION_ERROR,
                code=ErrorCode.BUILDING_FAILED,
                message=f"Workflow generation failed: {str(e)}",
                is_retryable=False,
            )
            return cls._error_response(error)

    @classmethod
    def _generate_workflow_internal(
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
    ) -> dict[str, Any]:
        """Internal implementation with structured error handling."""
        # Initialize model
        try:
            model_manager = ModelManager()
            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=model_config.get("provider", ""),
                model=model_config.get("name", ""),
            )
        except Exception as e:
            logger.exception("Failed to initialize model")
            error = WorkflowGenerationError(
                type=ErrorType.SYSTEM_ERROR,
                code=ErrorCode.MODEL_UNAVAILABLE,
                message=f"Model {model_config.get('provider')}/{model_config.get('name')} is not available: {str(e)}",
                is_retryable=False,
                suggestions=["Configure the model in Settings", "Choose a different model"],
            )
            return cls._error_response(error)

        model_parameters = model_config.get("completion_params", {})
        # Ensure max_tokens is set to prevent output truncation
        if "max_tokens" not in model_parameters:
            model_parameters["max_tokens"] = 8192
        available_tools_list = list(available_tools) if available_tools else []

        # Initialize StructuredOutputStrategy to detect preferred output method
        output_strategy = StructuredOutputStrategy(model_instance)
        preferred_method = output_strategy.preferred_method
        logger.info(
            "Using output method: %s",
            preferred_method.value,
            extra={"output_method": preferred_method.value},
        )

        # Check if this is modification mode (user is refining existing workflow)
        has_existing_nodes = existing_nodes and len(list(existing_nodes)) > 0

        # --- STEP 1: PLANNER (Skip in modification mode) ---
        if has_existing_nodes:
            # In modification mode, skip Planner:
            # - User intent is clear: modify the existing workflow
            # - Tools are already in use (from existing nodes)
            # - No need for intent classification or tool selection
            plan_output = PlannerOutput(
                intent=INTENT_GENERATE,
                analysis={},
                execution_plan=[],
                tool_selection={"required": [], "optional": []},
            )
            filtered_tools = available_tools_list  # Use all available tools
        else:
            # In creation mode, run Planner to validate intent and select tools
            try:
                # Use enhanced Planner class (instead of direct LLM call)
                planner = Planner(model_instance, model_parameters)
                plan_output = planner.plan(instruction, available_tools_list)

                # Handle off-topic intent
                if plan_output.intent == INTENT_OFF_TOPIC:
                    return {
                        "intent": INTENT_OFF_TOPIC,
                        "message": plan_output.message or "I can only help with workflow creation.",
                        "suggestions": plan_output.suggestions,
                    }

            except Exception as e:
                logger.exception("Planner failed", extra={"instruction": instruction})
                error = WorkflowGenerationError(
                    type=ErrorType.GENERATION_ERROR,
                    code=ErrorCode.PLANNING_FAILED,
                    message=f"Planning failed: {str(e)}",
                    is_retryable=True,
                )
                return cls._error_response(error)

            # --- STEP 2: CONTEXT FILTERING ---
            tool_selection = plan_output.tool_selection
            if isinstance(tool_selection, dict):
                required_tools = tool_selection.get("required", [])
            else:
                required_tools = tool_selection.required

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
        retry_strategy = RetryStrategy()
        workflow_data = None
        mermaid_code = None
        all_warnings = []
        all_fixes = []
        retry_count = 0
        validation_hints = []
        plan_thought = ""

        for attempt in range(MAX_RETRIES):
            retry_count = attempt
            logger.info(
                "Generation attempt %s/%s",
                attempt + 1,
                MAX_RETRIES,
                extra={"attempt": attempt + 1, "max_retries": MAX_RETRIES},
            )

            # Prepare context
            tool_schemas = format_available_tools(filtered_tools)  # type: ignore
            node_specs = format_available_nodes(list(available_nodes) if available_nodes else [])  # type: ignore
            existing_nodes_context = format_existing_nodes(list(existing_nodes) if existing_nodes else None)
            existing_edges_context = format_existing_edges(list(existing_edges) if existing_edges else None)
            selected_nodes_context = format_selected_nodes(
                list(selected_node_ids) if selected_node_ids else None,
                list(existing_nodes) if existing_nodes else None,
            )

            # Build retry context using RetryStrategy
            retry_context_str = ""
            if attempt > 0 and validation_hints:
                # Create RetryContext for error context generation
                retry_ctx = RetryContext(
                    attempt=attempt,
                    max_attempts=MAX_RETRIES,
                    validation_errors=[
                        {"message": h.message, "severity": h.severity, "node_id": h.node_id}
                        for h in validation_hints
                        if h.severity == "error"
                    ],
                )
                retry_context_str = retry_strategy.build_error_context(retry_ctx)

            # Get plan context (update from plan_output)
            if isinstance(plan_output.analysis, dict):
                plan_thought = plan_output.analysis.get("plan_thought", "")

            builder_system = BUILDER_SYSTEM_PROMPT.format(
                plan_context=json.dumps([], indent=2),  # Execution plan integration in next task
                tool_schemas=tool_schemas,
                builtin_node_specs=node_specs,
                available_models=format_available_models(list(available_models or [])),  # type: ignore
                preferred_language=preferred_language or "English",
                existing_nodes_context=existing_nodes_context,
                existing_edges_context=existing_edges_context,
                selected_nodes_context=selected_nodes_context,
            )
            builder_user = BUILDER_USER_PROMPT.format(instruction=instruction) + (
                f"\n{retry_context_str}" if retry_context_str else ""
            )

            # Apply temperature adjustment if retrying
            current_params = model_parameters.copy()
            if attempt > 0:
                retry_ctx = RetryContext(attempt=attempt, max_attempts=MAX_RETRIES)
                decision = retry_strategy.decide(retry_ctx)
                if decision.temperature_adjustment is not None:
                    current_params["temperature"] = decision.temperature_adjustment
                    logger.info(
                        "Adjusted temperature to %s",
                        decision.temperature_adjustment,
                        extra={"temperature": decision.temperature_adjustment},
                    )

            try:
                build_res = model_instance.invoke_llm(
                    prompt_messages=[
                        SystemPromptMessage(content=builder_system),
                        UserPromptMessage(content=builder_user),
                    ],
                    model_parameters=current_params,
                    stream=False,
                )

                build_content = build_res.message.content
                if not isinstance(build_content, str):
                    raise ValueError("LLM response content is not a string")

                # Builder output is raw JSON nodes/edges - use parse_structured_output
                workflow_data = parse_structured_output(build_content)

                if "nodes" not in workflow_data:
                    workflow_data["nodes"] = []
                if "edges" not in workflow_data:
                    workflow_data["edges"] = []

            except ValueError as e:
                # JSON parsing failed
                logger.exception("Builder JSON parsing failed on attempt %d", attempt + 1)
                if attempt == MAX_RETRIES - 1:
                    error = WorkflowGenerationError(
                        type=ErrorType.GENERATION_ERROR,
                        code=ErrorCode.JSON_PARSE_FAILED,
                        message=f"Failed to parse LLM response: {str(e)}",
                        is_retryable=False,
                    )
                    return cls._error_response(error)
                continue  # Try again
            except Exception as e:
                logger.exception("Builder failed on attempt %d", attempt + 1)
                if attempt == MAX_RETRIES - 1:
                    error = WorkflowGenerationError(
                        type=ErrorType.GENERATION_ERROR,
                        code=ErrorCode.BUILDING_FAILED,
                        message=f"Building failed: {str(e)}",
                        is_retryable=False,
                    )
                    return cls._error_response(error)
                continue  # Try again

            # --- STEP 4: RENDERER (Generate Mermaid early for validation) ---
            mermaid_code = generate_mermaid(workflow_data)  # type: ignore

            # --- STEP 5: GRAPH VALIDATION (structural checks - ALWAYS) ---
            graph_result = GraphValidator.validate(workflow_data)  # type: ignore
            validation_hints = []

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

            # Also add warnings (dead ends)
            for graph_warning in graph_result.warnings:
                validation_hints.append(
                    ValidationHint(
                        node_id=graph_warning.node_id,
                        field="edges",
                        message=f"[Graph] {graph_warning.message}",
                        severity="warning",
                    )
                )

            # --- STEP 6: WORKFLOW VALIDATOR (business logic) ---
            _, workflow_hints = WorkflowValidator.validate(workflow_data, available_tools_list)  # type: ignore
            validation_hints.extend(workflow_hints)

            # Collect all validation warnings
            all_warnings = [h.message for h in validation_hints]

            # Check if we should retry
            severe_issues = [h for h in validation_hints if h.severity == "error"]

            if not severe_issues or attempt == MAX_RETRIES - 1:
                break

            # Has severe errors and retries remaining - check retry decision
            retry_ctx = RetryContext(
                attempt=attempt + 1,
                max_attempts=MAX_RETRIES,
                validation_errors=[
                    {"message": h.message, "severity": h.severity, "node_id": h.node_id} for h in severe_issues
                ],
            )
            decision = retry_strategy.decide(retry_ctx)

            if not decision.should_retry:
                logger.warning("Retry strategy decided not to retry: %s", decision.reason)
                break

            logger.info("Retrying: %s", decision.reason)
            # Continue to next attempt

        # Check if we exhausted retries with errors
        severe_issues = [h for h in validation_hints if h.severity == "error"]
        if severe_issues and retry_count == MAX_RETRIES - 1:
            logger.warning(
                "Max retries exceeded with %d validation errors",
                len(severe_issues),
                extra={"error_count": len(severe_issues)},
            )
            # Still return the workflow but include errors

        # Add stability warning (as requested by user)
        stability_warning = STABILITY_WARNING_EN
        if preferred_language and preferred_language.startswith("zh"):
            stability_warning = STABILITY_WARNING_ZH
        all_warnings.append(stability_warning)

        # workflow_data and mermaid_code are guaranteed to be set if we reach here
        assert workflow_data is not None
        assert mermaid_code is not None

        return {
            "intent": INTENT_GENERATE,
            "flowchart": mermaid_code,
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "message": plan_thought or "Generated workflow based on your request.",
            "warnings": all_warnings,
            "tool_recommendations": [],  # Legacy field
            "error": "",
            "fixed_issues": all_fixes,  # Track what was auto-fixed
            "retry_count": retry_count,  # Track how many retries were needed
        }

    @classmethod
    def _error_response(cls, error: WorkflowGenerationError) -> dict[str, Any]:
        """
        Convert WorkflowGenerationError to response dict.

        Returns:
            dict with intent="error" and error details
        """
        return {
            "intent": INTENT_ERROR,
            "error": error.message,
            "error_code": error.code.value,
            "error_type": error.type.value,
            "is_retryable": error.is_retryable,
            "suggestions": error.suggestions,
            "details": error.details,
        }
