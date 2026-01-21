import json
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

import json_repair

from core.llm_generator.output_models import (
    CodeNodeStructuredOutput,
    InstructionModifyOutput,
    SuggestedQuestionsOutput,
)
from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import (
    CONVERSATION_TITLE_PROMPT,
    GENERATOR_QA_PROMPT,
    JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE,
    LLM_MODIFY_CODE_SYSTEM,
    LLM_MODIFY_PROMPT_SYSTEM,
    PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE,
    SUGGESTED_QUESTIONS_MAX_TOKENS,
    SUGGESTED_QUESTIONS_TEMPERATURE,
    SYSTEM_STRUCTURED_OUTPUT_GENERATE,
    WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
)
from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import App, Message, WorkflowNodeExecutionModel
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowServiceInterface(Protocol):
    def get_draft_workflow(self, app_model: App, workflow_id: str | None = None) -> Workflow | None:
        pass

    def get_node_last_run(self, app_model: App, workflow: Workflow, node_id: str) -> WorkflowNodeExecutionModel | None:
        pass


class LLMGenerator:
    @classmethod
    def generate_conversation_name(
        cls, tenant_id: str, query, conversation_id: str | None = None, app_id: str | None = None
    ):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        query = query.replace("\n", " ")

        prompt += query + "\n"

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )
        prompts = [UserPromptMessage(content=prompt)]

        with measure_time() as timer:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompts), model_parameters={"max_tokens": 500, "temperature": 1}, stream=False
            )
        answer = response.message.get_text_content()
        if answer == "":
            return ""
        try:
            result_dict = json.loads(answer)
        except json.JSONDecodeError:
            result_dict = json_repair.loads(answer)

        if not isinstance(result_dict, dict):
            answer = query
        else:
            output = result_dict.get("Your Output")
            if isinstance(output, str) and output.strip():
                answer = output.strip()
            else:
                answer = query

        name = answer.strip()

        if len(name) > 75:
            name = name[:75] + "..."

        # get tracing instance
        trace_manager = TraceQueueManager(app_id=app_id)
        trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.GENERATE_NAME_TRACE,
                conversation_id=conversation_id,
                generate_conversation_name=name,
                inputs=prompt,
                timer=timer,
                tenant_id=tenant_id,
            )
        )

        return name

    @classmethod
    def generate_suggested_questions_after_answer(cls, tenant_id: str, histories: str) -> Sequence[str]:
        output_parser = SuggestedQuestionsAfterAnswerOutputParser()
        format_instructions = output_parser.get_format_instructions()

        prompt_template = PromptTemplateParser(template="{{histories}}\n{{format_instructions}}\nquestions:\n")

        prompt = prompt_template.format({"histories": histories, "format_instructions": format_instructions})

        try:
            model_manager = ModelManager()
            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )
        except InvokeAuthorizationError:
            return []

        prompt_messages = [UserPromptMessage(content=prompt)]

        questions: Sequence[str] = []

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters={
                    "max_tokens": SUGGESTED_QUESTIONS_MAX_TOKENS,
                    "temperature": SUGGESTED_QUESTIONS_TEMPERATURE,
                },
                stream=False,
            )

            text_content = response.message.get_text_content()
            questions = output_parser.parse(text_content) if text_content else []
        except InvokeError:
            questions = []
        except Exception:
            logger.exception("Failed to generate suggested questions after answer")
            questions = []

        return questions

    @classmethod
    def generate_rule_config(cls, tenant_id: str, instruction: str, model_config: dict, no_variable: bool):
        output_parser = RuleConfigGeneratorOutputParser()

        error = ""
        error_step = ""
        rule_config = {"prompt": "", "variables": [], "opening_statement": "", "error": ""}
        model_parameters = model_config.get("completion_params", {})
        if no_variable:
            prompt_template = PromptTemplateParser(WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE)

            prompt_generate = prompt_template.format(
                inputs={
                    "TASK_DESCRIPTION": instruction,
                },
                remove_template_variables=False,
            )

            prompt_messages = [UserPromptMessage(content=prompt_generate)]

            model_manager = ModelManager()

            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=model_config.get("provider", ""),
                model=model_config.get("name", ""),
            )

            try:
                response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )

                rule_config["prompt"] = response.message.get_text_content()

            except InvokeError as e:
                error = str(e)
                error_step = "generate rule config"
            except Exception as e:
                logger.exception("Failed to generate rule config, model: %s", model_config.get("name"))
                rule_config["error"] = str(e)

            rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

            return rule_config

        # get rule config prompt, parameter and statement
        prompt_generate, parameter_generate, statement_generate = output_parser.get_format_instructions()

        prompt_template = PromptTemplateParser(prompt_generate)

        parameter_template = PromptTemplateParser(parameter_generate)

        statement_template = PromptTemplateParser(statement_generate)

        # format the prompt_generate_prompt
        prompt_generate_prompt = prompt_template.format(
            inputs={
                "TASK_DESCRIPTION": instruction,
            },
            remove_template_variables=False,
        )
        prompt_messages = [UserPromptMessage(content=prompt_generate_prompt)]

        # get model instance
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        try:
            try:
                # the first step to generate the task prompt
                prompt_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )
            except InvokeError as e:
                error = str(e)
                error_step = "generate prefix prompt"
                rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

                return rule_config

            rule_config["prompt"] = prompt_content.message.get_text_content()

            parameter_generate_prompt = parameter_template.format(
                inputs={
                    "INPUT_TEXT": prompt_content.message.get_text_content(),
                },
                remove_template_variables=False,
            )
            parameter_messages = [UserPromptMessage(content=parameter_generate_prompt)]

            # the second step to generate the task_parameter and task_statement
            statement_generate_prompt = statement_template.format(
                inputs={
                    "TASK_DESCRIPTION": instruction,
                    "INPUT_TEXT": prompt_content.message.get_text_content(),
                },
                remove_template_variables=False,
            )
            statement_messages = [UserPromptMessage(content=statement_generate_prompt)]

            try:
                parameter_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(parameter_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["variables"] = re.findall(r'"\s*([^"]+)\s*"', parameter_content.message.get_text_content())
            except InvokeError as e:
                error = str(e)
                error_step = "generate variables"

            try:
                statement_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(statement_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["opening_statement"] = statement_content.message.get_text_content()
            except InvokeError as e:
                error = str(e)
                error_step = "generate conversation opener"

        except Exception as e:
            logger.exception("Failed to generate rule config, model: %s", model_config.get("name"))
            rule_config["error"] = str(e)

        rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

        return rule_config

    @classmethod
    def generate_code(cls, tenant_id: str, instruction: str, model_config: dict, code_language: str = "javascript"):
        if code_language == "python":
            prompt_template = PromptTemplateParser(PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE)
        else:
            prompt_template = PromptTemplateParser(JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE)

        prompt = prompt_template.format(
            inputs={
                "INSTRUCTION": instruction,
                "CODE_LANGUAGE": code_language,
            },
            remove_template_variables=False,
        )

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages = [UserPromptMessage(content=prompt)]
        model_parameters = model_config.get("completion_params", {})
        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            generated_code = response.message.get_text_content()
            return {"code": generated_code, "language": code_language, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"code": "", "language": code_language, "error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception(
                "Failed to invoke LLM model, model: %s, language: %s", model_config.get("name"), code_language
            )
            return {"code": "", "language": code_language, "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def generate_qa_document(cls, tenant_id: str, query, document_language: str):
        prompt = GENERATOR_QA_PROMPT.format(language=document_language)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages: list[PromptMessage] = [SystemPromptMessage(content=prompt), UserPromptMessage(content=query)]

        # Explicitly use the non-streaming overload
        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={"temperature": 0.01, "max_tokens": 2000},
            stream=False,
        )

        # Runtime type check since pyright has issues with the overload
        if not isinstance(result, LLMResult):
            raise TypeError("Expected LLMResult when stream=False")
        response = result

        answer = response.message.get_text_content()
        return answer.strip()

    @classmethod
    def generate_structured_output(cls, tenant_id: str, instruction: str, model_config: dict):
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages = [
            SystemPromptMessage(content=SYSTEM_STRUCTURED_OUTPUT_GENERATE),
            UserPromptMessage(content=instruction),
        ]
        model_parameters = model_config.get("model_parameters", {})

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            raw_content = response.message.get_text_content()

            try:
                parsed_content = json.loads(raw_content)
            except json.JSONDecodeError:
                parsed_content = json_repair.loads(raw_content)

            if not isinstance(parsed_content, dict | list):
                raise ValueError(f"Failed to parse structured output from llm: {raw_content}")

            generated_json_schema = json.dumps(parsed_content, indent=2, ensure_ascii=False)
            return {"output": generated_json_schema, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"output": "", "error": f"Failed to generate JSON Schema. Error: {error}"}
        except Exception as e:
            logger.exception("Failed to invoke LLM model, model: %s", model_config.get("name"))
            return {"output": "", "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def generate_with_context(
        cls,
        tenant_id: str,
        workflow_id: str,
        node_id: str,
        parameter_name: str,
        language: str,
        prompt_messages: list[PromptMessage],
        model_config: dict,
    ) -> dict:
        """
        Generate extractor code node based on conversation context.

        Args:
            tenant_id: Tenant/workspace ID
            workflow_id: Workflow ID
            node_id: Current tool/llm node ID
            parameter_name: Parameter name to generate code for
            language: Code language (python3/javascript)
            prompt_messages: Multi-turn conversation history (last message is instruction)
            model_config: Model configuration (provider, name, completion_params)

        Returns:
            dict with CodeNodeData format:
            - variables: Input variable selectors
            - code_language: Code language
            - code: Generated code
            - outputs: Output definitions
            - message: Explanation
            - error: Error message if any
        """
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from services.workflow_service import WorkflowService

        # Get workflow
        with Session(db.engine) as session:
            stmt = select(App).where(App.id == workflow_id)
            app = session.scalar(stmt)
            if not app:
                return cls._error_response(f"App {workflow_id} not found")

            workflow = WorkflowService().get_draft_workflow(app_model=app)
            if not workflow:
                return cls._error_response(f"Workflow for app {workflow_id} not found")

        # Get upstream nodes via edge backtracking
        upstream_nodes = cls._get_upstream_nodes(workflow.graph_dict, node_id)

        # Get current node info
        current_node = cls._get_node_by_id(workflow.graph_dict, node_id)
        if not current_node:
            return cls._error_response(f"Node {node_id} not found")

        # Get parameter info
        parameter_info = cls._get_parameter_info(
            tenant_id=tenant_id,
            node_data=current_node.get("data", {}),
            parameter_name=parameter_name,
        )

        # Build system prompt
        system_prompt = cls._build_extractor_system_prompt(
            upstream_nodes=upstream_nodes,
            current_node=current_node,
            parameter_info=parameter_info,
            language=language,
        )

        # Construct complete prompt_messages with system prompt
        complete_messages: list[PromptMessage] = [
            SystemPromptMessage(content=system_prompt),
            *prompt_messages,
        ]

        from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model

        # Get model instance and schema
        provider = model_config.get("provider", "")
        model_name = model_config.get("name", "")
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=provider,
            model=model_name,
        )

        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return cls._error_response(f"Model schema not found for {model_name}")

        model_parameters = model_config.get("completion_params", {})
        try:
            response = invoke_llm_with_pydantic_model(
                provider=provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=complete_messages,
                output_model=CodeNodeStructuredOutput,
                model_parameters=model_parameters,
                stream=False,
                tenant_id=tenant_id,
            )

            return cls._parse_code_node_output(
                response.structured_output, language, parameter_info.get("type", "string")
            )

        except InvokeError as e:
            return cls._error_response(str(e))
        except Exception as e:
            logger.exception("Failed to generate with context, model: %s", model_config.get("name"))
            return cls._error_response(f"An unexpected error occurred: {str(e)}")

    @classmethod
    def _error_response(cls, error: str) -> dict:
        """Return error response in CodeNodeData format."""
        return {
            "variables": [],
            "code_language": "python3",
            "code": "",
            "outputs": {},
            "message": "",
            "error": error,
        }

    @classmethod
    def generate_suggested_questions(
        cls,
        tenant_id: str,
        workflow_id: str,
        node_id: str,
        parameter_name: str,
        language: str,
        model_config: dict | None = None,
    ) -> dict:
        """
        Generate suggested questions for context generation.

        Returns dict with questions array and error field.
        """
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model
        from services.workflow_service import WorkflowService

        # Get workflow context (reuse existing logic)
        with Session(db.engine) as session:
            stmt = select(App).where(App.id == workflow_id)
            app = session.scalar(stmt)
            if not app:
                return {"questions": [], "error": f"App {workflow_id} not found"}

            workflow = WorkflowService().get_draft_workflow(app_model=app)
            if not workflow:
                return {"questions": [], "error": f"Workflow for app {workflow_id} not found"}

        upstream_nodes = cls._get_upstream_nodes(workflow.graph_dict, node_id)
        current_node = cls._get_node_by_id(workflow.graph_dict, node_id)
        if not current_node:
            return {"questions": [], "error": f"Node {node_id} not found"}

        parameter_info = cls._get_parameter_info(
            tenant_id=tenant_id,
            node_data=current_node.get("data", {}),
            parameter_name=parameter_name,
        )

        # Build prompt
        system_prompt = cls._build_suggested_questions_prompt(
            upstream_nodes=upstream_nodes,
            current_node=current_node,
            parameter_info=parameter_info,
            language=language,
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=system_prompt),
        ]

        # Get model instance - use default if model_config not provided
        model_manager = ModelManager()
        if model_config:
            provider = model_config.get("provider", "")
            model_name = model_config.get("name", "")
            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=provider,
                model=model_name,
            )
        else:
            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )
            model_name = model_instance.model

        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return {"questions": [], "error": f"Model schema not found for {model_name}"}

        completion_params = model_config.get("completion_params", {}) if model_config else {}
        model_parameters = {**completion_params, "max_tokens": 256}
        try:
            response = invoke_llm_with_pydantic_model(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                output_model=SuggestedQuestionsOutput,
                model_parameters=model_parameters,
                stream=False,
                tenant_id=tenant_id,
            )

            questions = response.structured_output.get("questions", []) if response.structured_output else []
            return {"questions": questions, "error": ""}

        except InvokeError as e:
            return {"questions": [], "error": str(e)}
        except Exception as e:
            logger.exception("Failed to generate suggested questions, model: %s", model_name)
            return {"questions": [], "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def _build_suggested_questions_prompt(
        cls,
        upstream_nodes: list[dict],
        current_node: dict,
        parameter_info: dict,
        language: str = "English",
    ) -> str:
        """Build minimal prompt for suggested questions generation."""
        # Simplify upstream nodes to reduce tokens
        sources = [f"{n['title']}({','.join(n.get('outputs', {}).keys())})" for n in upstream_nodes[:5]]
        param_type = parameter_info.get("type", "string")
        param_desc = parameter_info.get("description", "")[:100]

        return f"""Suggest 3 code generation questions for extracting data.
Sources: {", ".join(sources)}
Target: {parameter_info.get("name")}({param_type}) - {param_desc}
Output 3 short, practical questions in {language}."""

    @classmethod
    def _get_upstream_nodes(cls, graph_dict: Mapping[str, Any], node_id: str) -> list[dict]:
        """
        Get all upstream nodes via edge backtracking.

        Traverses the graph backwards from node_id to collect all reachable nodes.
        """
        from collections import defaultdict

        nodes = {n["id"]: n for n in graph_dict.get("nodes", [])}
        edges = graph_dict.get("edges", [])

        # Build reverse adjacency list
        reverse_adj: dict[str, list[str]] = defaultdict(list)
        for edge in edges:
            reverse_adj[edge["target"]].append(edge["source"])

        # BFS to find all upstream nodes
        visited: set[str] = set()
        queue = [node_id]
        upstream: list[dict] = []

        while queue:
            current = queue.pop(0)
            for source in reverse_adj.get(current, []):
                if source not in visited:
                    visited.add(source)
                    queue.append(source)
                    if source in nodes:
                        upstream.append(cls._extract_node_info(nodes[source]))

        return upstream

    @classmethod
    def _get_node_by_id(cls, graph_dict: Mapping[str, Any], node_id: str) -> dict | None:
        """Get node by ID from graph."""
        for node in graph_dict.get("nodes", []):
            if node["id"] == node_id:
                return node
        return None

    @classmethod
    def _extract_node_info(cls, node: dict) -> dict:
        """Extract minimal node info with outputs based on node type."""
        node_type = node["data"]["type"]
        node_data = node.get("data", {})

        # Build outputs based on node type (only type, no description to reduce tokens)
        outputs: dict[str, str] = {}
        match node_type:
            case "start":
                for var in node_data.get("variables", []):
                    name = var.get("variable", var.get("name", ""))
                    outputs[name] = var.get("type", "string")
            case "llm":
                outputs["text"] = "string"
            case "code":
                for name, output in node_data.get("outputs", {}).items():
                    outputs[name] = output.get("type", "string")
            case "http-request":
                outputs = {"body": "string", "status_code": "number", "headers": "object"}
            case "knowledge-retrieval":
                outputs["result"] = "array[object]"
            case "tool":
                outputs = {"text": "string", "json": "object"}
            case _:
                outputs["output"] = "string"

        info: dict = {
            "id": node["id"],
            "title": node_data.get("title", node["id"]),
            "outputs": outputs,
        }
        # Only include description if not empty
        desc = node_data.get("desc", "")
        if desc:
            info["desc"] = desc

        return info

    @classmethod
    def _get_parameter_info(cls, tenant_id: str, node_data: dict, parameter_name: str) -> dict:
        """Get parameter info from tool schema using ToolManager."""
        default_info = {"name": parameter_name, "type": "string", "description": ""}

        if node_data.get("type") != "tool":
            return default_info

        try:
            from core.app.entities.app_invoke_entities import InvokeFrom
            from core.tools.entities.tool_entities import ToolProviderType
            from core.tools.tool_manager import ToolManager

            provider_type_str = node_data.get("provider_type", "")
            provider_type = ToolProviderType(provider_type_str) if provider_type_str else ToolProviderType.BUILT_IN

            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=provider_type,
                provider_id=node_data.get("provider_id", ""),
                tool_name=node_data.get("tool_name", ""),
                tenant_id=tenant_id,
                invoke_from=InvokeFrom.DEBUGGER,
            )

            parameters = tool_runtime.get_merged_runtime_parameters()
            for param in parameters:
                if param.name == parameter_name:
                    return {
                        "name": param.name,
                        "type": param.type.value if hasattr(param.type, "value") else str(param.type),
                        "description": param.llm_description
                        or (param.human_description.en_US if param.human_description else ""),
                        "required": param.required,
                    }
        except Exception as e:
            logger.debug("Failed to get parameter info from ToolManager: %s", e)

        return default_info

    @classmethod
    def _build_extractor_system_prompt(
        cls,
        upstream_nodes: list[dict],
        current_node: dict,
        parameter_info: dict,
        language: str,
    ) -> str:
        """Build system prompt for extractor code generation."""
        upstream_json = json.dumps(upstream_nodes, indent=2, ensure_ascii=False)
        param_type = parameter_info.get("type", "string")
        return f"""You are a code generator for workflow automation.

Generate {language} code to extract/transform upstream node outputs for the target parameter.

## Upstream Nodes
{upstream_json}

## Target
Node: {current_node["data"].get("title", current_node["id"])}
Parameter: {parameter_info.get("name")} ({param_type}) - {parameter_info.get("description", "")}

## Requirements
- Write a main function that returns type: {param_type}
- Use value_selector format: ["node_id", "output_name"]
"""

    @classmethod
    def _parse_code_node_output(cls, content: Mapping[str, Any] | None, language: str, parameter_type: str) -> dict:
        """
        Parse structured output to CodeNodeData format.

        Args:
            content: Structured output dict from invoke_llm_with_structured_output
            language: Code language
            parameter_type: Expected parameter type

        Returns dict with variables, code_language, code, outputs, message, error.
        """
        if content is None:
            return cls._error_response("Empty or invalid response from LLM")

        # Validate and normalize variables
        variables = [
            {"variable": v.get("variable", ""), "value_selector": v.get("value_selector", [])}
            for v in content.get("variables", [])
            if isinstance(v, dict)
        ]

        outputs = content.get("outputs", {"result": {"type": parameter_type}})

        return {
            "variables": variables,
            "code_language": language,
            "code": content.get("code", ""),
            "outputs": outputs,
            "message": content.get("explanation", ""),
            "error": "",
        }

    @staticmethod
    def instruction_modify_legacy(
        tenant_id: str, flow_id: str, current: str, instruction: str, model_config: dict, ideal_output: str | None
    ):
        last_run: Message | None = (
            db.session.query(Message).where(Message.app_id == flow_id).order_by(Message.created_at.desc()).first()
        )
        if not last_run:
            return LLMGenerator.__instruction_modify_common(
                tenant_id=tenant_id,
                model_config=model_config,
                last_run=None,
                current=current,
                error_message="",
                instruction=instruction,
                node_type="llm",
                ideal_output=ideal_output,
            )
        last_run_dict = {
            "query": last_run.query,
            "answer": last_run.answer,
            "error": last_run.error,
        }
        return LLMGenerator.__instruction_modify_common(
            tenant_id=tenant_id,
            model_config=model_config,
            last_run=last_run_dict,
            current=current,
            error_message=str(last_run.error),
            instruction=instruction,
            node_type="llm",
            ideal_output=ideal_output,
        )

    @staticmethod
    def instruction_modify_workflow(
        tenant_id: str,
        flow_id: str,
        node_id: str,
        current: str,
        instruction: str,
        model_config: dict,
        ideal_output: str | None,
        workflow_service: WorkflowServiceInterface,
    ):
        session = db.session()

        app: App | None = session.query(App).where(App.id == flow_id).first()
        if not app:
            raise ValueError("App not found.")
        workflow = workflow_service.get_draft_workflow(app_model=app)
        if not workflow:
            raise ValueError("Workflow not found for the given app model.")
        last_run = workflow_service.get_node_last_run(app_model=app, workflow=workflow, node_id=node_id)
        try:
            node_type = cast(WorkflowNodeExecutionModel, last_run).node_type
        except Exception:
            try:
                node_type = [it for it in workflow.graph_dict["graph"]["nodes"] if it["id"] == node_id][0]["data"][
                    "type"
                ]
            except Exception:
                node_type = "llm"

        if not last_run:  # Node is not executed yet
            return LLMGenerator.__instruction_modify_common(
                tenant_id=tenant_id,
                model_config=model_config,
                last_run=None,
                current=current,
                error_message="",
                instruction=instruction,
                node_type=node_type,
                ideal_output=ideal_output,
            )

        def agent_log_of(node_execution: WorkflowNodeExecutionModel) -> Sequence:
            raw_agent_log = node_execution.execution_metadata_dict.get(WorkflowNodeExecutionMetadataKey.AGENT_LOG, [])
            if not raw_agent_log:
                return []

            return [
                {
                    "status": event["status"],
                    "error": event["error"],
                    "data": event["data"],
                }
                for event in raw_agent_log
            ]

        inputs = last_run.load_full_inputs(session, storage)
        last_run_dict = {
            "inputs": inputs,
            "status": last_run.status,
            "error": last_run.error,
            "agent_log": agent_log_of(last_run),
        }

        return LLMGenerator.__instruction_modify_common(
            tenant_id=tenant_id,
            model_config=model_config,
            last_run=last_run_dict,
            current=current,
            error_message=last_run.error,
            instruction=instruction,
            node_type=last_run.node_type,
            ideal_output=ideal_output,
        )

    @staticmethod
    def __instruction_modify_common(
        tenant_id: str,
        model_config: dict,
        last_run: dict | None,
        current: str | None,
        error_message: str | None,
        instruction: str,
        node_type: str,
        ideal_output: str | None,
    ):
        LAST_RUN = "{{#last_run#}}"
        CURRENT = "{{#current#}}"
        ERROR_MESSAGE = "{{#error_message#}}"
        injected_instruction = instruction
        if LAST_RUN in injected_instruction:
            injected_instruction = injected_instruction.replace(LAST_RUN, json.dumps(last_run))
        if CURRENT in injected_instruction:
            injected_instruction = injected_instruction.replace(CURRENT, current or "null")
        if ERROR_MESSAGE in injected_instruction:
            injected_instruction = injected_instruction.replace(ERROR_MESSAGE, error_message or "null")
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )
        model_name = model_config.get("name", "")
        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return {"error": f"Model schema not found for {model_name}"}
        match node_type:
            case "llm" | "agent":
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
            case "code":
                system_prompt = LLM_MODIFY_CODE_SYSTEM
            case _:
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
        prompt_messages = [
            SystemPromptMessage(content=system_prompt),
            UserPromptMessage(
                content=json.dumps(
                    {
                        "current": current,
                        "last_run": last_run,
                        "instruction": injected_instruction,
                        "ideal_output": ideal_output,
                    }
                )
            ),
        ]
        model_parameters = {"temperature": 0.4}

        try:
            from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model

            response = invoke_llm_with_pydantic_model(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=list(prompt_messages),
                output_model=InstructionModifyOutput,
                model_parameters=model_parameters,
                stream=False,
            )
            return response.structured_output or {}
        except InvokeError as e:
            error = str(e)
            return {"error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception(
                "Failed to invoke LLM model, model: %s", json.dumps(model_config.get("name")), exc_info=True
            )
            return {"error": f"An unexpected error occurred: {str(e)}"}
