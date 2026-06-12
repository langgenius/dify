import json
import os
import re
import threading
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import yaml

from core.dsl_agent import dependency_normalizer as dsl_dependency_normalizer
from core.dsl_agent import deterministic_repair as dsl_deterministic_repair
from core.dsl_agent import generation as dsl_generation
from core.dsl_agent import plugin_resolver as dsl_plugin_resolver
from core.dsl_agent import shape_normalizer as dsl_shape_normalizer
from core.dsl_agent import source_context as dsl_source_context
from core.dsl_agent import validator as dsl_validator
from services.plugin.dependencies_analysis import DependenciesAnalysisService

DEFAULT_MODEL_PROVIDER = "langgenius/openai/openai"
DEFAULT_MODEL_NAME = "gpt-4o-mini"
DEFAULT_GENERATION_MODEL = "gpt-5.5"
DEFAULT_INPUT_VARIABLE = "input"
DEFAULT_APP_NAME = "DSL Agent App"
GENERATION_BACKEND_DETERMINISTIC = "deterministic_starter"
GENERATION_BACKEND_OPENAI = "openai"
POSTPROCESS_CODE_KEYWORDS = (
    "csv",
    "extract",
    "field",
    "format",
    "json",
    "normalize",
    "parse",
    "schema",
    "structured",
    "table",
    "字段",
    "格式化",
    "结构化",
    "解析",
    "表格",
    "提取",
    "转换",
)
CLASSIFICATION_KEYWORDS = (
    "category",
    "classif",
    "categorize",
    "intent",
    "route",
    "routing",
    "triage",
    "分类",
    "路由",
)
IF_ELSE_KEYWORDS = (
    " if ",
    "else",
    "otherwise",
    "urgent",
    "high priority",
    "low priority",
    "如果",
    "否则",
    "紧急",
)
RAG_KEYWORDS = (
    "citation",
    "cite",
    "knowledge",
    "knowledge base",
    "rag",
    "retriev",
    "source",
    "引用",
    "知识库",
    "检索",
)
DSL_AGENT_STAGE_PLAN = "plan"
DSL_AGENT_STAGE_SOURCE_EVIDENCE = "source_evidence"
DSL_AGENT_STAGE_RESOLVE_DEPENDENCIES = "resolve_dependencies"
DSL_AGENT_STAGE_GENERATE = "generate"
DSL_AGENT_STAGE_NORMALIZE = "normalize"
DSL_AGENT_STAGE_VALIDATE = "validate"
DSL_AGENT_STAGE_REPAIR = "repair"
DSL_AGENT_RUN_STATUS_QUEUED = "queued"
DSL_AGENT_RUN_STATUS_RUNNING = "running"
DSL_AGENT_RUN_STATUS_SUCCEEDED = "succeeded"
DSL_AGENT_RUN_STATUS_FAILED = "failed"
DSL_AGENT_RUN_REDIS_KEY_PREFIX = "console:dsl_agent_run:"
DSL_AGENT_RUN_TTL_SECONDS = int(os.environ.get("DIFY_DSL_AGENT_RUN_TTL_SECONDS", str(24 * 60 * 60)))
DSL_AGENT_TASK_SOFT_TIME_LIMIT_SECONDS = int(os.environ.get("DIFY_DSL_AGENT_TASK_SOFT_TIME_LIMIT_SECONDS", "300"))
DSL_AGENT_TASK_TIME_LIMIT_SECONDS = int(
    os.environ.get("DIFY_DSL_AGENT_TASK_TIME_LIMIT_SECONDS", str(DSL_AGENT_TASK_SOFT_TIME_LIMIT_SECONDS + 30))
)


def normalize_generation_backend(generation_backend: str | None) -> str:
    value = (
        generation_backend
        or os.environ.get("DIFY_DSL_AGENT_GENERATION_BACKEND")
        or GENERATION_BACKEND_DETERMINISTIC
    ).strip().lower().replace("-", "_")
    if value in {GENERATION_BACKEND_OPENAI, "llm", "gpt"}:
        return GENERATION_BACKEND_OPENAI
    return GENERATION_BACKEND_DETERMINISTIC


@dataclass
class AppDslAgentGenerateArgs:
    prompt: str
    app_name: str | None = None
    app_description: str | None = None
    provider: str = DEFAULT_MODEL_PROVIDER
    model: str = DEFAULT_MODEL_NAME
    generation_backend: str | None = None
    generation_model: str | None = None
    input_variable: str = DEFAULT_INPUT_VARIABLE
    marketplace_plugin_id: str | None = None
    resolve_dependencies: bool = True


@dataclass
class AppDslAgentGenerateResult:
    yaml_content: str
    name: str
    description: str
    warnings: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


@dataclass
class AppDslAgentDebugRunArgs:
    inputs: dict[str, Any] = field(default_factory=dict)
    query: str = ""
    files: list[dict[str, Any]] | None = None
    include_events: bool = False


@dataclass
class AppDslAgentRepairArgs:
    yaml_content: str
    runtime_evidence: dict[str, Any] = field(default_factory=dict)
    validation: dict[str, Any] | None = None


@dataclass
class AppDslAgentRunEvent:
    sequence: int
    stage: str
    status: str
    message: str
    created_at: str


@dataclass
class AppDslAgentRun:
    id: str
    status: str
    created_at: str
    updated_at: str
    request: dict
    account_id: str | None = None
    tenant_id: str | None = None
    current_stage: str | None = None
    result: AppDslAgentGenerateResult | None = None
    error: str | None = None
    events: list[AppDslAgentRunEvent] = field(default_factory=list)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def serialize_generate_result(result: AppDslAgentGenerateResult) -> dict:
    return {
        "yaml_content": result.yaml_content,
        "name": result.name,
        "description": result.description,
        "warnings": result.warnings,
        "metadata": result.metadata,
    }


def serialize_run(run: AppDslAgentRun) -> dict:
    return {
        "id": run.id,
        "status": run.status,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "current_stage": run.current_stage,
        "request": run.request,
        "result": serialize_generate_result(run.result) if run.result else None,
        "error": run.error,
        "events": [event.__dict__ for event in run.events],
    }


def _serialize_run_for_store(run: AppDslAgentRun) -> dict:
    payload = serialize_run(run)
    payload["account_id"] = run.account_id
    payload["tenant_id"] = run.tenant_id
    return payload


def _deserialize_generate_result(payload: dict | None) -> AppDslAgentGenerateResult | None:
    if not isinstance(payload, dict):
        return None
    return AppDslAgentGenerateResult(
        yaml_content=str(payload.get("yaml_content") or ""),
        name=str(payload.get("name") or DEFAULT_APP_NAME),
        description=str(payload.get("description") or ""),
        warnings=list(payload.get("warnings") or []),
        metadata=dict(payload.get("metadata") or {}),
    )


def _deserialize_run(payload: dict) -> AppDslAgentRun:
    events = []
    for event in payload.get("events") or []:
        if not isinstance(event, dict):
            continue
        events.append(
            AppDslAgentRunEvent(
                sequence=int(event.get("sequence") or len(events) + 1),
                stage=str(event.get("stage") or ""),
                status=str(event.get("status") or ""),
                message=str(event.get("message") or ""),
                created_at=str(event.get("created_at") or utc_now_iso()),
            )
        )
    return AppDslAgentRun(
        id=str(payload.get("id") or ""),
        status=str(payload.get("status") or DSL_AGENT_RUN_STATUS_FAILED),
        created_at=str(payload.get("created_at") or utc_now_iso()),
        updated_at=str(payload.get("updated_at") or utc_now_iso()),
        request=dict(payload.get("request") or {}),
        account_id=payload.get("account_id"),
        tenant_id=payload.get("tenant_id"),
        current_stage=payload.get("current_stage"),
        result=_deserialize_generate_result(payload.get("result")),
        error=payload.get("error"),
        events=events,
    )


def enqueue_app_dsl_agent_run(run_id: str) -> None:
    from tasks.app_dsl_agent_generate_task import run_app_dsl_agent_generation_task

    run_app_dsl_agent_generation_task.delay(run_id)


def parse_sse_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event_name: str | None = None
    data_lines: list[str] = []

    def flush() -> None:
        nonlocal event_name, data_lines
        if not data_lines:
            event_name = None
            return
        payload_text = "\n".join(data_lines).strip()
        current_event = event_name
        event_name = None
        data_lines = []
        if not payload_text or payload_text == "[DONE]":
            return
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            payload = {"raw": payload_text}
        if isinstance(payload, dict):
            if current_event and "event" not in payload:
                payload["sse_event"] = current_event
            events.append(payload)
        else:
            events.append({"event": current_event, "data": payload})

    for line in text.splitlines():
        if not line.strip():
            flush()
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line.removeprefix("event:").strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").lstrip())
            continue
        if line.startswith("id:") or line.startswith("retry:"):
            continue
        data_lines.append(line)
    flush()
    return events


def summarize_stream_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "event_count": len(events),
        "task_id": None,
        "workflow_run_id": None,
        "status": None,
        "succeeded": None,
        "outputs": None,
        "node_statuses": [],
        "failed_nodes": [],
        "errors": [],
    }
    successful_statuses = {"succeeded", "partial-succeeded"}

    for event in events:
        name = str(event.get("event") or event.get("sse_event") or "")
        data = event.get("data")
        if not isinstance(data, dict):
            data = event

        if (event.get("task_id") or data.get("task_id")) and not summary["task_id"]:
            summary["task_id"] = event.get("task_id") or data.get("task_id")
        if (event.get("workflow_run_id") or data.get("workflow_run_id")) and not summary["workflow_run_id"]:
            summary["workflow_run_id"] = event.get("workflow_run_id") or data.get("workflow_run_id")

        if name == "workflow_started":
            run_id = event.get("workflow_run_id") or data.get("id")
            if run_id and not summary["workflow_run_id"]:
                summary["workflow_run_id"] = run_id

        is_workflow_finished = name == "workflow_finished" or (
            not name
            and isinstance(data, dict)
            and "status" in data
            and ("outputs" in data or "error" in data or "elapsed_time" in data or "total_steps" in data)
        )

        if is_workflow_finished:
            status = data.get("status")
            summary["status"] = status
            summary["outputs"] = data.get("outputs")
            summary["succeeded"] = status in successful_statuses and not data.get("error")
            if data.get("error"):
                summary["errors"].append(
                    {
                        "event": name,
                        "message": data.get("error"),
                        "workflow_run_id": event.get("workflow_run_id") or summary["workflow_run_id"],
                    }
                )

        if name == "node_finished":
            node = {
                "node_id": data.get("node_id"),
                "node_type": data.get("node_type"),
                "title": data.get("title"),
                "status": data.get("status"),
                "error": data.get("error"),
                "elapsed_time": data.get("elapsed_time"),
            }
            summary["node_statuses"].append(node)
            if data.get("error") or data.get("status") not in successful_statuses:
                summary["failed_nodes"].append(node)
                if data.get("error"):
                    summary["errors"].append(
                        {
                            "event": name,
                            "node_id": data.get("node_id"),
                            "node_type": data.get("node_type"),
                            "title": data.get("title"),
                            "message": data.get("error"),
                        }
                    )

        if name == "error":
            message = event.get("message") or event.get("error") or event.get("err") or data.get("message")
            summary["errors"].append({"event": name, "message": str(message)})

    if summary["succeeded"] is None and summary["errors"]:
        summary["succeeded"] = False
    return summary


def format_stream_result(raw_text: str, *, include_events: bool = False) -> dict[str, Any]:
    events = parse_sse_events(raw_text)
    result: dict[str, Any] = {
        "summary": summarize_stream_events(events),
        "event_count": len(events),
    }
    if include_events:
        result["events"] = events
    return result


class AppDslAgentService:
    def generate(
        self,
        args: AppDslAgentGenerateArgs,
        progress: Callable[[str, str, str], None] | None = None,
    ) -> AppDslAgentGenerateResult:
        return DslAgentOrchestrator().run(args, progress=progress)


class AppDslAgentDebugService:
    def run_draft_workflow_and_repair(
        self,
        app_model,
        account,
        *,
        yaml_content: str,
        args: AppDslAgentDebugRunArgs,
        validation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        draft_run = self.run_draft_workflow(app_model=app_model, account=account, args=args)
        summary = draft_run.get("summary") if isinstance(draft_run.get("summary"), dict) else {}
        needs_repair = (
            summary.get("succeeded") is False
            or bool(summary.get("failed_nodes"))
            or bool(summary.get("errors"))
        )
        repair = self.repair_yaml(
            AppDslAgentRepairArgs(
                yaml_content=yaml_content,
                runtime_evidence={"draft_run": draft_run},
                validation=validation,
            )
        )
        return {
            "draft_run": draft_run,
            "needs_repair": needs_repair,
            "repair": repair,
        }

    def repair_yaml(self, args: AppDslAgentRepairArgs) -> dict[str, Any]:
        orchestrator = DslAgentOrchestrator()
        input_validation = args.validation or orchestrator.validate_yaml(args.yaml_content, raise_on_error=False)
        repaired_yaml, repair_report = orchestrator.repair_yaml(
            args.yaml_content,
            input_validation,
            runtime_evidence=args.runtime_evidence,
        )
        final_validation = orchestrator.validate_yaml(repaired_yaml, raise_on_error=False)
        return {
            "yaml_content": repaired_yaml,
            "changed": repaired_yaml != args.yaml_content or bool(repair_report.get("changed")),
            "input_validation": input_validation,
            "validation": final_validation,
            "repair": repair_report,
        }

    def run_draft_workflow(self, app_model, account, args: AppDslAgentDebugRunArgs) -> dict[str, Any]:
        from core.app.entities.app_invoke_entities import InvokeFrom
        from models.model import AppMode
        from services.app_generate_service import AppGenerateService

        payload: dict[str, Any] = {"inputs": args.inputs}
        if args.files is not None:
            payload["files"] = args.files
        if app_model.mode == AppMode.ADVANCED_CHAT:
            payload["query"] = args.query

        response = AppGenerateService.generate(
            app_model=app_model,
            user=account,
            args=payload,
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=False,
        )
        raw_text = self._response_to_text(response)
        result = format_stream_result(raw_text, include_events=args.include_events)
        result["mode"] = app_model.mode
        return result

    def _response_to_text(self, response: Any) -> str:
        if isinstance(response, str):
            return response
        if isinstance(response, bytes):
            return response.decode("utf-8", errors="replace")
        if isinstance(response, Mapping):
            return f"data: {json.dumps(response, ensure_ascii=False)}\n\n"
        if isinstance(response, Iterable):
            chunks: list[str] = []
            for chunk in response:
                if isinstance(chunk, bytes):
                    chunks.append(chunk.decode("utf-8", errors="replace"))
                else:
                    chunks.append(str(chunk))
            return "".join(chunks)
        return str(response)


class DslAgentOrchestrator:
    backend = GENERATION_BACKEND_DETERMINISTIC
    _plugin_resolver_lock = threading.RLock()
    _plugin_resolver_instance: Any = None

    def run(
        self,
        args: AppDslAgentGenerateArgs,
        progress: Callable[[str, str, str], None] | None = None,
    ) -> AppDslAgentGenerateResult:
        emit = self._emitter(progress)

        emit(DSL_AGENT_STAGE_PLAN, "running", "Preparing workflow plan.")
        plan = self.plan(args)
        emit(DSL_AGENT_STAGE_PLAN, "completed", "Workflow plan prepared.")

        emit(DSL_AGENT_STAGE_SOURCE_EVIDENCE, "running", "Collecting source-grounded generation evidence.")
        source_evidence = self.collect_source_evidence(plan)
        emit(DSL_AGENT_STAGE_SOURCE_EVIDENCE, "completed", "Source evidence collected.")

        emit(DSL_AGENT_STAGE_RESOLVE_DEPENDENCIES, "running", "Resolving model and plugin dependencies.")
        dependencies, warnings = self.resolve_dependencies(plan)
        emit(DSL_AGENT_STAGE_RESOLVE_DEPENDENCIES, "completed", "Dependency resolution completed.")

        emit(DSL_AGENT_STAGE_GENERATE, "running", "Generating Dify DSL YAML.")
        yaml_content, generation_report, generation_warnings = self.generate_yaml_content(
            plan, dependencies, source_evidence
        )
        warnings.extend(generation_warnings)
        emit(DSL_AGENT_STAGE_GENERATE, "completed", "Dify DSL YAML generated.")

        emit(DSL_AGENT_STAGE_NORMALIZE, "running", "Normalizing generated DSL.")
        yaml_content, normalization_report = self.normalize_yaml(yaml_content, source_evidence)
        emit(DSL_AGENT_STAGE_NORMALIZE, "completed", "Generated DSL normalized.")

        emit(DSL_AGENT_STAGE_VALIDATE, "running", "Validating generated YAML.")
        validation_report = self.validate_yaml(yaml_content, raise_on_error=False)
        repair_report = {"changed": False, "fixes": [], "errors": [], "backend": "not_needed"}
        if self._validation_report_valid(validation_report):
            emit(DSL_AGENT_STAGE_VALIDATE, "completed", "Generated YAML is valid.")
            emit(DSL_AGENT_STAGE_REPAIR, "skipped", "No repair was needed for this workflow.")
        else:
            emit(DSL_AGENT_STAGE_VALIDATE, "completed", "Generated YAML needs repair.")
            emit(DSL_AGENT_STAGE_REPAIR, "running", "Repairing generated YAML.")
            yaml_content, repair_report = self.repair_generated_yaml(
                yaml_content, validation_report, plan, source_evidence
            )
            emit(DSL_AGENT_STAGE_REPAIR, "completed", "Generated YAML repair completed.")
            emit(DSL_AGENT_STAGE_VALIDATE, "running", "Validating repaired YAML.")
            validation_report = self.validate_yaml(yaml_content, raise_on_error=False)
            if self._validation_report_valid(validation_report):
                emit(DSL_AGENT_STAGE_VALIDATE, "completed", "Repaired YAML is valid.")
            elif plan.get("generation_backend") == GENERATION_BACKEND_OPENAI:
                fallback_reason = self._validation_error_message(validation_report)
                emit(DSL_AGENT_STAGE_REPAIR, "running", "Falling back to deterministic starter YAML.")
                fallback_data = self.generate_dsl_mapping(plan, dependencies)
                yaml_content = yaml.safe_dump(fallback_data, allow_unicode=True, sort_keys=False)
                yaml_content, fallback_normalization_report = self.normalize_yaml(yaml_content, source_evidence)
                validation_report = self.validate_yaml(yaml_content)
                normalization_report["fallback_normalization"] = fallback_normalization_report
                generation_report = {
                    "backend": GENERATION_BACKEND_DETERMINISTIC,
                    "fallback_from": GENERATION_BACKEND_OPENAI,
                    "fallback_reason": fallback_reason,
                    "previous_generation": generation_report,
                }
                repair_report = {
                    "changed": True,
                    "fixes": [{"type": "openai_validation_fallback", "reason": fallback_reason}],
                    "errors": [],
                    "backend": "deterministic_starter_fallback",
                    "previous_repair": repair_report,
                }
                emit(DSL_AGENT_STAGE_REPAIR, "completed", "Deterministic starter fallback completed.")
                emit(DSL_AGENT_STAGE_VALIDATE, "completed", "Fallback YAML is valid.")
            else:
                self.validate_yaml(yaml_content)

        return AppDslAgentGenerateResult(
            yaml_content=yaml_content,
            name=plan["app_name"],
            description=plan["app_description"],
            warnings=warnings,
            metadata={
                "mode": "workflow",
                "backend": generation_report.get("backend") or self.backend,
                "provider": plan["provider"],
                "model": plan["model"],
                "generation_model": plan["generation_model"],
                "input_variable": plan["input_variable"],
                "dependency_count": len(dependencies),
                "plan": plan,
                "source_evidence": self._public_source_evidence(source_evidence),
                "generation": generation_report,
                "normalization": normalization_report,
                "validation": validation_report,
                "repair": repair_report,
            },
        )

    def plan(self, args: AppDslAgentGenerateArgs) -> dict:
        prompt = args.prompt.strip()
        app_name = self._normalize_app_name(args.app_name, prompt)
        app_description = (args.app_description or "Generated from a natural language requirement.").strip()
        provider = (args.provider or DEFAULT_MODEL_PROVIDER).strip()
        model = (args.model or DEFAULT_MODEL_NAME).strip()
        generation_model = (
            args.generation_model
            or os.environ.get("DIFY_DSL_AGENT_GENERATION_MODEL")
            or os.environ.get("OPENAI_MODEL")
            or DEFAULT_GENERATION_MODEL
        ).strip()
        generation_backend = self._normalize_generation_backend(args.generation_backend)
        input_variable = self._normalize_variable(args.input_variable)
        plugin_id = (args.marketplace_plugin_id or self._plugin_id_from_provider(provider)).strip()
        graph_plan = self._deterministic_graph_plan(prompt)
        plan = {
            "app_name": app_name,
            "app_description": app_description,
            "prompt": prompt,
            "provider": provider,
            "model": model,
            "generation_backend": generation_backend,
            "generation_model": generation_model,
            "input_variable": input_variable,
            "plugin_id": plugin_id,
            "resolve_dependencies": args.resolve_dependencies,
            "graph_plan": graph_plan,
        }
        if generation_backend == GENERATION_BACKEND_OPENAI:
            self._attach_openai_plan(plan)
        return plan

    def collect_source_evidence(self, plan: dict) -> dict:
        plugin_id = str(plan.get("plugin_id") or "")
        evidence = {
            "policy": [
                "Use Dify workflow graph format with start, llm, and end nodes.",
                "Use the requested model provider as a plugin dependency when possible.",
                "Keep generated YAML importable before adding complex agent behavior.",
            ],
            "model_provider": {
                "provider": plan["provider"],
                "plugin_id": plugin_id,
                "source": "provider id derived from requested model provider",
            },
            "dsl_shape": {
                "version": "0.6.0",
                "kind": "app",
                "mode": "workflow",
                "required_workflow_sections": [
                    "graph",
                    "features",
                    "environment_variables",
                    "conversation_variables",
                ],
            },
        }
        plugin_evidence = self._fallback_plugin_evidence(plugin_id)
        try:
            resolver = self._get_plugin_resolver()
            plugin_evidence = resolver.resolve(str(plan.get("prompt") or ""), limit=6)
            evidence["plugin_resolver"] = {
                "backend": "core.dsl_agent.plugin_resolver",
                **self._summarize_plugin_evidence(plugin_evidence),
            }
        except Exception as exc:
            evidence["plugin_resolver"] = {
                "backend": "fallback",
                "error": str(exc),
                **self._summarize_plugin_evidence(plugin_evidence),
            }
        evidence["plugin_evidence"] = plugin_evidence

        source_context_plan = plan.get("llm_plan") if isinstance(plan.get("llm_plan"), dict) else plan
        try:
            source_context = dsl_source_context.SourceContextCollector().collect(source_context_plan)
            evidence["source_context"] = {
                "backend": "core.dsl_agent.source_context",
                **self._summarize_source_context(source_context),
            }
            evidence["_source_context_full"] = source_context
        except Exception as exc:
            evidence["source_context"] = {
                "backend": "fallback",
                "error": str(exc),
                **self._summarize_source_context(self._fallback_source_context(source_context_plan)),
            }
        return evidence

    def resolve_dependencies(self, plan: dict) -> tuple[list[dict], list[str]]:
        plugin_id = str(plan.get("plugin_id") or "").strip()
        resolve_dependencies = bool(plan.get("resolve_dependencies", True))
        warnings: list[str] = []
        dependencies = []
        if plugin_id:
            dependency = self._resolve_marketplace_dependency(plugin_id, resolve_dependencies, warnings)
            if dependency:
                dependencies.append(dependency)
        return dependencies, warnings

    def generate_dsl_mapping(self, plan: dict, dependencies: list[dict]) -> dict:
        return {
            "app": {
                "description": plan["app_description"],
                "icon": "\U0001f916",
                "icon_background": "#EFF6FF",
                "icon_type": "emoji",
                "mode": "workflow",
                "name": plan["app_name"],
                "use_icon_as_answer_icon": False,
            },
            "dependencies": dependencies,
            "kind": "app",
            "version": "0.6.0",
            "workflow": {
                "conversation_variables": [],
                "environment_variables": [],
                "features": {
                    "file_upload": {},
                    "sensitive_word_avoidance": {"enabled": False},
                    "text_to_speech": {"enabled": False, "language": "", "voice": ""},
                },
                "graph": self._build_graph(plan),
                "rag_pipeline_variables": [],
            },
        }

    def generate_yaml_content(
        self, plan: dict, dependencies: list[dict], source_evidence: dict
    ) -> tuple[str, dict, list[str]]:
        if plan.get("generation_backend") == GENERATION_BACKEND_OPENAI:
            yaml_content, report = self._generate_openai_yaml_content(plan, source_evidence)
            if yaml_content:
                return yaml_content, report, []

            data = self.generate_dsl_mapping(plan, dependencies)
            return yaml.safe_dump(data, allow_unicode=True, sort_keys=False), {
                "backend": GENERATION_BACKEND_DETERMINISTIC,
                "fallback_from": GENERATION_BACKEND_OPENAI,
                "fallback_reason": report.get("error") or "OpenAI generation did not return YAML.",
            }, [
                f"OpenAI DSL generation fell back to deterministic starter: {report.get('error') or 'empty YAML'}"
            ]

        data = self.generate_dsl_mapping(plan, dependencies)
        return yaml.safe_dump(data, allow_unicode=True, sort_keys=False), {
            "backend": GENERATION_BACKEND_DETERMINISTIC,
        }, []

    def _generate_openai_yaml_content(self, plan: dict, source_evidence: dict) -> tuple[str | None, dict]:
        if not os.environ.get("OPENAI_API_KEY"):
            return None, {"backend": GENERATION_BACKEND_OPENAI, "error": "OPENAI_API_KEY is not configured"}

        try:
            client = self._openai_client()
            llm_plan = (
                plan.get("llm_plan") if isinstance(plan.get("llm_plan"), dict) else self._fallback_llm_plan(plan)
            )
            plugin_evidence = (
                source_evidence.get("plugin_evidence")
                if isinstance(source_evidence.get("plugin_evidence"), dict)
                else {}
            )
            prompt_plugin_evidence = dsl_generation.compact_plugin_evidence_for_prompt(plugin_evidence, llm_plan)
            source_context = (
                source_evidence.get("_source_context_full")
                if isinstance(source_evidence.get("_source_context_full"), dict)
                else {}
            )
            prompt_source_context = dsl_generation.compact_source_context_for_prompt(source_context)
            yaml_content = dsl_generation.generate_yaml(
                client=client,
                model=plan["generation_model"],
                request=self._generation_request(plan),
                plan=llm_plan,
                plugin_evidence=prompt_plugin_evidence,
                source_context=prompt_source_context,
            )
            self._apply_yaml_app_metadata(plan, yaml_content)
            return yaml_content, {
                "backend": GENERATION_BACKEND_OPENAI,
                "model": plan["generation_model"],
                "prompt_plugin_candidates": self._summarize_plugin_evidence(prompt_plugin_evidence),
            }
        except Exception as exc:
            return None, {
                "backend": GENERATION_BACKEND_OPENAI,
                "model": plan["generation_model"],
                "error": self._safe_generation_error_message(exc),
            }

    def normalize_yaml(self, yaml_content: str, source_evidence: dict | None = None) -> tuple[str, dict]:
        original = yaml_content
        current = yaml_content
        normalizers: list[dict[str, Any]] = []

        try:
            current, report = dsl_shape_normalizer.normalize_shape_yaml_text(current)
            normalizers.append(
                {
                    "name": "shape_normalizer",
                    "backend": "core.dsl_agent.shape_normalizer",
                    "report": report,
                }
            )
        except Exception as exc:
            normalizers.append(
                {
                    "name": "shape_normalizer",
                    "backend": "fallback",
                    "error": str(exc),
                }
            )

        try:
            plugin_evidence = {}
            if isinstance(source_evidence, dict):
                plugin_evidence = source_evidence.get("plugin_evidence") or {}
            current, report = dsl_dependency_normalizer.normalize_yaml_text(current, plugin_evidence)
            normalizers.append(
                {
                    "name": "dependency_normalizer",
                    "backend": "core.dsl_agent.dependency_normalizer",
                    "report": report,
                }
            )
        except Exception as exc:
            normalizers.append(
                {
                    "name": "dependency_normalizer",
                    "backend": "fallback",
                    "error": str(exc),
                }
            )

        try:
            data = yaml.safe_load(current)
            current = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
            normalizers.append(
                {
                    "name": "yaml_roundtrip",
                    "backend": "yaml.safe_load/safe_dump",
                    "report": {"changed": current != original},
                }
            )
        except Exception as exc:
            normalizers.append(
                {
                    "name": "yaml_roundtrip",
                    "backend": "fallback",
                    "error": str(exc),
                }
            )

        return current, {
            "changed": current != original or any(
                bool((item.get("report") or {}).get("changed")) for item in normalizers
            ),
            "normalizers": normalizers,
        }

    def validate_yaml(self, yaml_content: str, *, raise_on_error: bool = True) -> dict:
        report_obj = dsl_validator.validate_yaml_text(yaml_content)
        report = report_obj.to_dict() if hasattr(report_obj, "to_dict") else report_obj
        if raise_on_error and not self._validation_report_valid(report):
            raise ValueError(f"Generated DSL failed validation: {self._validation_error_message(report)}")
        return report

    def repair_yaml(
        self,
        yaml_content: str,
        validation_report: dict,
        *,
        runtime_evidence: dict[str, Any] | None = None,
    ) -> tuple[str, dict]:
        try:
            repaired, report = dsl_deterministic_repair.repair_yaml_text(
                yaml_content,
                validation=validation_report,
                runtime_evidence=runtime_evidence,
            )
            report["backend"] = "core.dsl_agent.deterministic_repair"
            return repaired, report
        except Exception as exc:
            return yaml_content, {
                "changed": False,
                "fixes": [],
                "errors": [{"message": str(exc)}],
                "backend": "fallback",
            }

    def repair_generated_yaml(
        self,
        yaml_content: str,
        validation_report: dict,
        plan: dict,
        source_evidence: dict,
    ) -> tuple[str, dict]:
        if plan.get("generation_backend") == GENERATION_BACKEND_OPENAI and os.environ.get("OPENAI_API_KEY"):
            try:
                llm_plan = (
                    plan.get("llm_plan") if isinstance(plan.get("llm_plan"), dict) else self._fallback_llm_plan(plan)
                )
                plugin_evidence = (
                    source_evidence.get("plugin_evidence")
                    if isinstance(source_evidence.get("plugin_evidence"), dict)
                    else {}
                )
                prompt_plugin_evidence = dsl_generation.compact_plugin_evidence_for_prompt(plugin_evidence, llm_plan)
                source_context = (
                    source_evidence.get("_source_context_full")
                    if isinstance(source_evidence.get("_source_context_full"), dict)
                    else {}
                )
                prompt_source_context = dsl_generation.compact_source_context_for_prompt(source_context)
                repaired = dsl_generation.repair_yaml(
                    client=self._openai_client(),
                    model=plan["generation_model"],
                    request=self._generation_request(plan),
                    plan=llm_plan,
                    plugin_evidence=prompt_plugin_evidence,
                    source_context=prompt_source_context,
                    yaml_text=yaml_content,
                    validation=validation_report,
                )
                return repaired, {
                    "changed": repaired != yaml_content,
                    "fixes": [{"type": "llm_validation_repair"}],
                    "errors": [],
                    "backend": "core.dsl_agent.generation.repair_yaml",
                    "model": plan["generation_model"],
                }
            except Exception as exc:
                repaired, report = self.repair_yaml(yaml_content, validation_report)
                report["llm_repair_error"] = self._safe_generation_error_message(exc)
                return repaired, report

        return self.repair_yaml(yaml_content, validation_report)

    def _normalize_generation_backend(self, generation_backend: str | None) -> str:
        return normalize_generation_backend(generation_backend)

    def _attach_openai_plan(self, plan: dict) -> None:
        if not os.environ.get("OPENAI_API_KEY"):
            plan["generation_plan_error"] = "OPENAI_API_KEY is not configured"
            return

        try:
            llm_plan = dsl_generation.generate_plan(
                self._openai_client(),
                plan["generation_model"],
                self._generation_request(plan),
            )
            plan["llm_plan"] = llm_plan
            app = llm_plan.get("app") if isinstance(llm_plan.get("app"), dict) else {}
            if app.get("description"):
                plan["app_description"] = str(app["description"]).strip()
            graph_plan = llm_plan.get("graph_plan") if isinstance(llm_plan.get("graph_plan"), dict) else None
            if graph_plan:
                plan["graph_plan"] = graph_plan
        except Exception as exc:
            plan["generation_plan_error"] = self._safe_generation_error_message(exc)

    def _generation_request(self, plan: dict) -> str:
        return (
            f"{plan['prompt'].strip()}\n\n"
            "Target Dify app constraints:\n"
            f"- Preferred app name: {plan['app_name']}\n"
            f"- Preferred app mode: workflow\n"
            f"- Preferred model provider: {plan['provider']}\n"
            f"- Preferred model name: {plan['model']}\n"
            f"- Preferred start input variable: {plan['input_variable']}\n"
            "- Generate importable Dify app DSL YAML.\n"
        )

    def _fallback_llm_plan(self, plan: dict) -> dict:
        return {
            "app": {
                "name": plan["app_name"],
                "mode": "workflow",
                "description": plan["app_description"],
            },
            "requirements": {
                "goal": plan["prompt"],
                "inputs": [plan["input_variable"]],
                "outputs": ["answer"],
                "needs_rag": False,
                "needs_human_review": False,
                "needs_plugins": [plan["plugin_id"]] if plan.get("plugin_id") else [],
                "needs_triggers": [],
                "open_questions": [],
            },
            "graph_plan": plan.get("graph_plan") or {},
        }

    def _openai_client(self):
        from openai import OpenAI

        timeout = float(
            os.environ.get("DIFY_DSL_AGENT_OPENAI_TIMEOUT_SECONDS")
            or os.environ.get("OPENAI_TIMEOUT_SECONDS")
            or "90"
        )
        return OpenAI(timeout=timeout)

    def _public_source_evidence(self, source_evidence: dict) -> dict:
        return {
            key: value
            for key, value in source_evidence.items()
            if not str(key).startswith("_")
        }

    def _safe_generation_error_message(self, exc: Exception) -> str:
        message = str(exc)
        lowered = message.lower()
        if "insufficient_quota" in lowered or "exceeded your current quota" in lowered:
            return "OpenAI quota is exhausted for the configured API key."
        if "invalid_api_key" in lowered or "incorrect api key" in lowered or "401" in lowered:
            return "OpenAI API key is invalid or unauthorized."
        if "rate limit" in lowered or "429" in lowered:
            return "OpenAI request was rate limited."
        if "timed out" in lowered or "timeout" in lowered:
            return "OpenAI request timed out. Try again or choose a faster generation model."
        if len(message) > 500:
            return f"{message[:500]}..."
        return message

    def _apply_yaml_app_metadata(self, plan: dict, yaml_content: str) -> None:
        try:
            data = yaml.safe_load(yaml_content)
        except Exception:
            return
        if not isinstance(data, dict):
            return
        app = data.get("app")
        if not isinstance(app, dict):
            return
        if isinstance(app.get("name"), str) and app["name"].strip():
            plan["app_name"] = app["name"].strip()
        if isinstance(app.get("description"), str) and app["description"].strip():
            plan["app_description"] = app["description"].strip()

    def _get_plugin_resolver(self) -> Any:
        # One resolver instance per process: PluginResolver caches its filesystem
        # scan in instance attributes, so reusing it avoids re-scanning the
        # official plugins repo on every generation request.
        with self._plugin_resolver_lock:
            if self._plugin_resolver_instance is None:
                DslAgentOrchestrator._plugin_resolver_instance = dsl_plugin_resolver.PluginResolver()
            return self._plugin_resolver_instance

    def _fallback_plugin_evidence(self, plugin_id: str) -> dict:
        candidates = []
        if plugin_id:
            candidates.append(
                {
                    "plugin_id": plugin_id,
                    "source": "official" if plugin_id.startswith("langgenius/") else "requested_provider",
                    "package_identity": plugin_id,
                    "exact_dependency_evidence": [],
                }
            )
        return {
            "resolution_policy": [
                "Prefer official Dify plugins.",
                "Use requested model provider plugin when resolver evidence is unavailable.",
            ],
            "official_candidates": candidates if plugin_id.startswith("langgenius/") else [],
            "model_provider_candidates": candidates,
            "extracted_template_candidates": [],
            "official_template_links": [],
        }

    def _summarize_plugin_evidence(self, plugin_evidence: dict) -> dict:
        return {
            "official_candidates_count": len(plugin_evidence.get("official_candidates") or []),
            "model_provider_candidates_count": len(plugin_evidence.get("model_provider_candidates") or []),
            "extracted_template_candidates_count": len(plugin_evidence.get("extracted_template_candidates") or []),
            "official_template_links_count": len(plugin_evidence.get("official_template_links") or []),
        }

    def _fallback_source_context(self, plan: dict) -> dict:
        graph_plan = plan.get("graph_plan") if isinstance(plan.get("graph_plan"), dict) else {}
        nodes = graph_plan.get("nodes") if isinstance(graph_plan.get("nodes"), list) else []
        node_types = sorted(
            {
                str(node.get("type"))
                for node in nodes
                if isinstance(node, dict) and node.get("type")
            }
        )
        return {
            "source_policy": [
                "Prefer local Dify source over public repo assumptions.",
                "Use snippets as schema evidence, not as code to execute.",
            ],
            "dsl_facts": {
                "current_app_dsl_version": "0.6.0",
                "facts": [
                    "App DSL imports require workflow data for workflow and advanced-chat apps.",
                    "Dependencies are checked from top-level dependencies when present.",
                ],
            },
            "node_types": node_types,
            "snippets": [],
        }

    def _summarize_source_context(self, source_context: dict) -> dict:
        dsl_facts = source_context.get("dsl_facts") if isinstance(source_context.get("dsl_facts"), dict) else {}
        snippets = source_context.get("snippets") if isinstance(source_context.get("snippets"), list) else []
        return {
            "current_app_dsl_version": dsl_facts.get("current_app_dsl_version"),
            "facts": dsl_facts.get("facts") or [],
            "node_types": source_context.get("node_types") or [],
            "snippet_count": len(snippets),
            "snippet_paths": [
                snippet.get("path")
                for snippet in snippets
                if isinstance(snippet, dict) and snippet.get("path")
            ][:8],
        }

    def _validation_report_valid(self, report: dict) -> bool:
        return bool(report.get("valid"))

    def _validation_error_message(self, report: dict) -> str:
        for issue in report.get("issues") or []:
            if issue.get("severity") == "error":
                return str(issue.get("message") or issue.get("code") or "validation failed")
        return "validation failed"

    def _emitter(
        self,
        progress: Callable[[str, str, str], None] | None,
    ) -> Callable[[str, str, str], None]:
        def emit(stage: str, status: str, message: str) -> None:
            if progress:
                progress(stage, status, message)

        return emit

    def _deterministic_graph_plan(self, prompt: str) -> dict:
        labels = self._classification_labels(prompt)
        if labels:
            nodes = [{"id": "start", "type": "start"}, {"id": "classify", "type": "question-classifier"}]
            edges = [{"source": "start", "target": "classify"}]
            for label in labels:
                reply_id = f"reply_{label}"
                finish_id = f"finish_{label}"
                nodes.extend(
                    [
                        {"id": reply_id, "type": "llm", "class_id": label},
                        {"id": finish_id, "type": "end", "class_id": label},
                    ]
                )
                edges.extend(
                    [
                        {"source": "classify", "target": reply_id, "source_handle": label},
                        {"source": reply_id, "target": finish_id},
                    ]
                )
            return {
                "mode": "workflow",
                "nodes": nodes,
                "edges": edges,
                "data_flow_notes": ["A question-classifier routes the input before short per-class LLM responses."],
            }

        if self._needs_rag_node(prompt):
            return {
                "mode": "workflow",
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "retrieve_knowledge", "type": "knowledge-retrieval"},
                    {"id": "llm", "type": "llm"},
                    {"id": "end", "type": "end"},
                ],
                "edges": [
                    {"source": "start", "target": "retrieve_knowledge"},
                    {"source": "retrieve_knowledge", "target": "llm"},
                    {"source": "llm", "target": "end"},
                ],
                "data_flow_notes": ["Knowledge retrieval feeds grounded context into the LLM answer node."],
            }

        if self._needs_if_else_node(prompt):
            return {
                "mode": "workflow",
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "if_else", "type": "if-else"},
                    {"id": "urgent_reply", "type": "llm"},
                    {"id": "normal_reply", "type": "llm"},
                    {"id": "finish_urgent", "type": "end"},
                    {"id": "finish_normal", "type": "end"},
                ],
                "edges": [
                    {"source": "start", "target": "if_else"},
                    {"source": "if_else", "target": "urgent_reply", "source_handle": "true"},
                    {"source": "if_else", "target": "normal_reply", "source_handle": "false"},
                    {"source": "urgent_reply", "target": "finish_urgent"},
                    {"source": "normal_reply", "target": "finish_normal"},
                ],
                "data_flow_notes": ["A native if-else branch routes urgent inputs separately from the default branch."],
            }

        nodes = [
            {"id": "start", "type": "start"},
            {"id": "llm", "type": "llm"},
        ]
        edges = [{"source": "start", "target": "llm"}]
        data_flow_notes = ["The start input is sent to the LLM node."]
        if self._needs_postprocess_code_node(prompt):
            nodes.append({"id": "postprocess", "type": "code"})
            edges.append({"source": "llm", "target": "postprocess"})
            data_flow_notes.append("A code node normalizes structured output before the end node.")
        nodes.append({"id": "end", "type": "end"})
        edges.append({"source": nodes[-2]["id"], "target": "end"})
        return {
            "mode": "workflow",
            "nodes": nodes,
            "edges": edges,
            "data_flow_notes": data_flow_notes,
        }

    def _needs_postprocess_code_node(self, prompt: str) -> bool:
        lowered = prompt.lower()
        return any(keyword in lowered for keyword in POSTPROCESS_CODE_KEYWORDS)

    def _needs_if_else_node(self, prompt: str) -> bool:
        lowered = f" {prompt.lower()} "
        return any(keyword in lowered for keyword in IF_ELSE_KEYWORDS)

    def _needs_rag_node(self, prompt: str) -> bool:
        lowered = prompt.lower()
        return any(keyword in lowered for keyword in RAG_KEYWORDS)

    def _classification_labels(self, prompt: str) -> list[str]:
        lowered = prompt.lower()
        if not any(keyword in lowered for keyword in CLASSIFICATION_KEYWORDS):
            return []
        patterns = [
            r"\bas\s+([a-z0-9][a-z0-9,_/\-\s]+?)(?:,?\s+(?:then|and\s+return|return|with)\b|[.;。]|$)",
            r"\binto\s+([a-z0-9][a-z0-9,_/\-\s]+?)(?:,?\s+(?:then|and\s+return|return|with)\b|[.;。]|$)",
        ]
        for pattern in patterns:
            match = re.search(pattern, lowered)
            if not match:
                continue
            labels = self._split_label_text(match.group(1))
            if len(labels) >= 2:
                return labels[:6]
        return ["primary", "secondary", "other"]

    def _split_label_text(self, value: str) -> list[str]:
        value = re.sub(r"\bor\b", ",", value)
        value = re.sub(r"\band\b", ",", value)
        labels: list[str] = []
        for raw_label in re.split(r"[,/、]+", value):
            label = self._slug(raw_label)
            if label and label not in labels:
                labels.append(label)
        return labels

    def _slug(self, value: str) -> str:
        slug = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower())
        slug = re.sub(r"_+", "_", slug).strip("_")
        return slug or "other"

    def _build_graph(self, plan: dict) -> dict:
        if self._plan_has_node_type(plan, "question-classifier"):
            return self._build_classifier_graph(plan)
        if self._plan_has_node_type(plan, "knowledge-retrieval"):
            return self._build_rag_graph(plan)
        if self._plan_has_node_type(plan, "if-else"):
            return self._build_if_else_graph(plan)

        prompt = str(plan["prompt"])
        provider = str(plan["provider"])
        model = str(plan["model"])
        input_variable = str(plan["input_variable"])
        postprocess_with_code = self._plan_has_node_type(plan, "code")
        system_prompt = (
            "You are a Dify workflow app generated from this requirement.\n"
            f"Requirement:\n{prompt}\n\n"
            "Use the user input to complete the requirement. Return only the final answer."
        )
        if postprocess_with_code:
            system_prompt += "\nIf the task asks for structured output, return valid JSON without markdown fences."
        edges = [
            self._graph_edge("start", "llm", "start", "llm"),
        ]
        if postprocess_with_code:
            edges.extend(
                [
                    self._graph_edge("llm", "postprocess", "llm", "code"),
                    self._graph_edge("postprocess", "end", "code", "end"),
                ]
            )
        else:
            edges.append(self._graph_edge("llm", "end", "llm", "end"))

        nodes = [
            self._start_node(input_variable),
            self._llm_node(prompt=system_prompt, provider=provider, model=model, input_variable=input_variable),
        ]
        if postprocess_with_code:
            nodes.append(self._postprocess_code_node())
        nodes.append(self._end_node(source_node_id="postprocess" if postprocess_with_code else "llm"))
        return {
            "edges": edges,
            "nodes": nodes,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
        }

    def _plan_has_node_type(self, plan: dict, node_type: str) -> bool:
        graph_plan = plan.get("graph_plan") if isinstance(plan.get("graph_plan"), dict) else {}
        nodes = graph_plan.get("nodes") if isinstance(graph_plan.get("nodes"), list) else []
        return any(isinstance(node, dict) and node.get("type") == node_type for node in nodes)

    def _build_classifier_graph(self, plan: dict) -> dict:
        prompt = str(plan["prompt"])
        provider = str(plan["provider"])
        model = str(plan["model"])
        input_variable = str(plan["input_variable"])
        labels = self._classification_labels(prompt)
        if not labels:
            labels = self._labels_from_graph_plan(plan) or ["primary", "secondary", "other"]
        nodes = [
            self._start_node(input_variable),
            self._question_classifier_node(labels, provider=provider, model=model, input_variable=input_variable),
        ]
        edges = [self._graph_edge("start", "classify", "start", "question-classifier")]
        for index, label in enumerate(labels):
            y = 40 + index * 170
            reply_id = f"reply_{label}"
            finish_id = f"finish_{label}"
            nodes.extend(
                [
                    self._llm_node(
                        prompt=(
                            f"The ticket was classified as `{label}`.\n"
                            "Use the original input to return the category and a short reasoning."
                        ),
                        provider=provider,
                        model=model,
                        input_variable=input_variable,
                        node_id=reply_id,
                        title=f"{label.replace('_', ' ').title()} Reasoning",
                        x=620,
                        y=y,
                    ),
                    self._end_node(node_id=finish_id, source_node_id=reply_id, x=960, y=y),
                ]
            )
            edges.extend(
                [
                    self._graph_edge(
                        "classify",
                        reply_id,
                        "question-classifier",
                        "llm",
                        source_handle=label,
                    ),
                    self._graph_edge(reply_id, finish_id, "llm", "end"),
                ]
            )
        return {"edges": edges, "nodes": nodes, "viewport": {"x": 0, "y": 0, "zoom": 0.8}}

    def _build_rag_graph(self, plan: dict) -> dict:
        prompt = str(plan["prompt"])
        provider = str(plan["provider"])
        model = str(plan["model"])
        input_variable = str(plan["input_variable"])
        return {
            "edges": [
                self._graph_edge("start", "retrieve_knowledge", "start", "knowledge-retrieval"),
                self._graph_edge("retrieve_knowledge", "llm", "knowledge-retrieval", "llm"),
                self._graph_edge("llm", "end", "llm", "end"),
            ],
            "nodes": [
                self._start_node(input_variable),
                self._knowledge_retrieval_node(input_variable),
                self._llm_node(
                    prompt=(
                        "Answer the user question using the retrieved knowledge context. "
                        "Include citations or source references when the retrieved context provides them.\n"
                        f"Requirement:\n{prompt}"
                    ),
                    provider=provider,
                    model=model,
                    input_variable=input_variable,
                    user_prompt=(
                        f"Question: {{{{#start.{input_variable}#}}}}\n\n"
                        "Retrieved context:\n{{#retrieve_knowledge.result#}}"
                    ),
                ),
                self._end_node(source_node_id="llm"),
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.8},
        }

    def _build_if_else_graph(self, plan: dict) -> dict:
        prompt = str(plan["prompt"])
        provider = str(plan["provider"])
        model = str(plan["model"])
        input_variable = str(plan["input_variable"])
        return {
            "edges": [
                self._graph_edge("start", "if_else", "start", "if-else"),
                self._graph_edge("if_else", "urgent_reply", "if-else", "llm", source_handle="true"),
                self._graph_edge("if_else", "normal_reply", "if-else", "llm", source_handle="false"),
                self._graph_edge("urgent_reply", "finish_urgent", "llm", "end"),
                self._graph_edge("normal_reply", "finish_normal", "llm", "end"),
            ],
            "nodes": [
                self._start_node(input_variable),
                self._if_else_node(input_variable),
                self._llm_node(
                    prompt=(
                        f"Urgent branch for this workflow requirement:\n{prompt}\n"
                        "Return an escalation-ready response."
                    ),
                    provider=provider,
                    model=model,
                    input_variable=input_variable,
                    node_id="urgent_reply",
                    title="Urgent Reply",
                    x=620,
                    y=40,
                ),
                self._llm_node(
                    prompt=(
                        f"Default branch for this workflow requirement:\n{prompt}\n"
                        "Return a normal support response."
                    ),
                    provider=provider,
                    model=model,
                    input_variable=input_variable,
                    node_id="normal_reply",
                    title="Normal Reply",
                    x=620,
                    y=240,
                ),
                self._end_node(node_id="finish_urgent", source_node_id="urgent_reply", x=960, y=40),
                self._end_node(node_id="finish_normal", source_node_id="normal_reply", x=960, y=240),
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.8},
        }

    def _labels_from_graph_plan(self, plan: dict) -> list[str]:
        graph_plan = plan.get("graph_plan") if isinstance(plan.get("graph_plan"), dict) else {}
        edges = graph_plan.get("edges") if isinstance(graph_plan.get("edges"), list) else []
        labels = []
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            handle = edge.get("source_handle") or edge.get("sourceHandle")
            label = self._slug(str(handle or ""))
            if label and label != "source" and label not in labels:
                labels.append(label)
        return labels[:6]

    def _graph_edge(
        self,
        source: str,
        target: str,
        source_type: str,
        target_type: str,
        *,
        source_handle: str = "source",
    ) -> dict:
        return {
            "data": {"isInLoop": False, "sourceType": source_type, "targetType": target_type},
            "id": f"{source}-{source_handle}-{target}-target",
            "source": source,
            "sourceHandle": source_handle,
            "target": target,
            "targetHandle": "target",
            "type": "custom",
        }

    def _start_node(self, input_variable: str) -> dict:
        return {
            "data": {
                "title": "Start",
                "type": "start",
                "variables": [
                    {
                        "label": "Input",
                        "max_length": 8000,
                        "required": True,
                        "type": "paragraph",
                        "variable": input_variable,
                    }
                ],
            },
            "id": "start",
            "position": {"x": 80, "y": 120},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "start",
        }

    def _llm_node(
        self,
        *,
        prompt: str,
        provider: str,
        model: str,
        input_variable: str,
        node_id: str = "llm",
        title: str = "Reason With Model",
        user_prompt: str | None = None,
        x: int = 420,
        y: int = 120,
    ) -> dict:
        return {
            "data": {
                "context": {"enabled": False, "variable_selector": []},
                "model": {
                    "completion_params": {"temperature": 0.2},
                    "mode": "chat",
                    "name": model,
                    "provider": provider,
                },
                "prompt_template": [
                    {"role": "system", "text": prompt},
                    {"role": "user", "text": user_prompt or f"{{{{#start.{input_variable}#}}}}"},
                ],
                "title": title,
                "type": "llm",
                "variables": [],
                "vision": {"enabled": False},
            },
            "id": node_id,
            "position": {"x": x, "y": y},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "llm",
        }

    def _question_classifier_node(
        self,
        labels: list[str],
        *,
        provider: str,
        model: str,
        input_variable: str,
    ) -> dict:
        return {
            "data": {
                "classes": [{"id": label, "name": label.replace("_", " ").title()} for label in labels],
                "instruction": "Classify the incoming user input into the best matching category.",
                "model": {
                    "completion_params": {"temperature": 0},
                    "mode": "chat",
                    "name": model,
                    "provider": provider,
                },
                "query_variable_selector": ["start", input_variable],
                "title": "Classify",
                "type": "question-classifier",
                "vision": {"enabled": False},
            },
            "id": "classify",
            "position": {"x": 360, "y": 120},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "question-classifier",
        }

    def _if_else_node(self, input_variable: str) -> dict:
        return {
            "data": {
                "cases": [
                    {
                        "case_id": "true",
                        "conditions": [
                            {
                                "comparison_operator": "contains",
                                "id": "contains_urgent",
                                "value": "urgent",
                                "varType": "string",
                                "variable_selector": ["start", input_variable],
                            }
                        ],
                        "logical_operator": "and",
                    }
                ],
                "desc": "",
                "title": "IF/ELSE",
                "type": "if-else",
            },
            "id": "if_else",
            "position": {"x": 360, "y": 120},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "if-else",
        }

    def _knowledge_retrieval_node(self, input_variable: str) -> dict:
        return {
            "data": {
                "dataset_ids": ["REPLACE_WITH_DATASET_ID"],
                "metadata_filtering_mode": "disabled",
                "multiple_retrieval_config": {
                    "reranking_enable": False,
                    "score_threshold": None,
                    "top_k": 3,
                },
                "query_variable_selector": ["start", input_variable],
                "retrieval_mode": "multiple",
                "title": "Retrieve Knowledge",
                "type": "knowledge-retrieval",
                "vision": {"enabled": False},
            },
            "id": "retrieve_knowledge",
            "position": {"x": 420, "y": 120},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "knowledge-retrieval",
        }

    def _postprocess_code_node(self) -> dict:
        return {
            "data": {
                "code": (
                    "import json\n\n"
                    "def main(text: str) -> dict:\n"
                    "    value = text.strip() if isinstance(text, str) else str(text)\n"
                    "    try:\n"
                    "        parsed = json.loads(value)\n"
                    "        value = json.dumps(parsed, ensure_ascii=False, indent=2)\n"
                    "    except Exception:\n"
                    "        pass\n"
                    "    return {\"result\": value}\n"
                ),
                "code_language": "python3",
                "desc": "",
                "outputs": {
                    "result": {
                        "children": None,
                        "type": "string",
                    }
                },
                "title": "Postprocess",
                "type": "code",
                "variables": [
                    {
                        "value_selector": ["llm", "text"],
                        "variable": "text",
                    }
                ],
            },
            "id": "postprocess",
            "position": {"x": 760, "y": 120},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "code",
        }

    def _end_node(self, *, source_node_id: str, node_id: str = "end", x: int | None = None, y: int = 120) -> dict:
        output_selector = [source_node_id, "result"] if source_node_id == "postprocess" else [source_node_id, "text"]
        return {
            "data": {
                "outputs": [
                    {
                        "value_selector": output_selector,
                        "value_type": "string",
                        "variable": "answer",
                    }
                ],
                "title": "End",
                "type": "end",
            },
            "id": node_id,
            "position": {"x": x if x is not None else (1100 if source_node_id == "postprocess" else 760), "y": y},
            "sourcePosition": "right",
            "targetPosition": "left",
            "type": "end",
        }

    def _resolve_marketplace_dependency(
        self, plugin_id: str, resolve_dependencies: bool, warnings: list[str]
    ) -> dict | None:
        if resolve_dependencies:
            try:
                dependencies = DependenciesAnalysisService.generate_latest_dependencies([plugin_id])
                if dependencies:
                    return dependencies[0].model_dump(mode="json")
            except Exception:
                warnings.append(f"Could not resolve the latest marketplace package for {plugin_id}.")

        return {
            "type": "marketplace",
            "value": {
                "marketplace_plugin_unique_identifier": plugin_id,
                "version": None,
            },
            "current_identifier": None,
        }

    def _normalize_app_name(self, app_name: str | None, prompt: str) -> str:
        value = (app_name or "").strip()
        if not value:
            first_line = next((line.strip() for line in prompt.splitlines() if line.strip()), "")
            value = first_line[:48].strip(" :-") if first_line else DEFAULT_APP_NAME
        return value or DEFAULT_APP_NAME

    def _normalize_variable(self, variable: str | None) -> str:
        value = (variable or DEFAULT_INPUT_VARIABLE).strip().lower()
        value = re.sub(r"[^a-z0-9_]+", "_", value)
        value = re.sub(r"_+", "_", value).strip("_")
        if not value or not re.match(r"^[a-z_]", value):
            return DEFAULT_INPUT_VARIABLE
        return value[:64]

    def _plugin_id_from_provider(self, provider: str) -> str:
        parts = provider.split("/")
        if len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"
        return provider


class AppDslAgentRunStore:
    def __init__(
        self,
        *,
        ttl_seconds: int = DSL_AGENT_RUN_TTL_SECONDS,
        redis_client: Any | None = None,
        enqueue_run: Callable[[str], None] | None = None,
    ) -> None:
        self._ttl_seconds = max(60, ttl_seconds)
        self._ttl_delta = timedelta(seconds=self._ttl_seconds)
        self._redis_client = redis_client
        self._enqueue_run = enqueue_run or enqueue_app_dsl_agent_run

    def create_run(
        self,
        args: AppDslAgentGenerateArgs,
        *,
        account_id: str | None = None,
        tenant_id: str | None = None,
    ) -> AppDslAgentRun:
        now = utc_now_iso()
        run = AppDslAgentRun(
            id=str(uuid.uuid4()),
            status=DSL_AGENT_RUN_STATUS_QUEUED,
            created_at=now,
            updated_at=now,
            account_id=account_id,
            tenant_id=tenant_id,
            request={
                "prompt": args.prompt,
                "app_name": args.app_name,
                "app_description": args.app_description,
                "provider": args.provider,
                "model": args.model,
                "generation_backend": args.generation_backend,
                "generation_model": args.generation_model,
                "input_variable": args.input_variable,
                "marketplace_plugin_id": args.marketplace_plugin_id,
                "resolve_dependencies": args.resolve_dependencies,
            },
        )
        self._append_event(run, "queued", "queued", "DSL generation run queued.")
        self._save_run(run)
        try:
            self._enqueue_run(run.id)
        except Exception as exc:
            run.status = DSL_AGENT_RUN_STATUS_FAILED
            run.current_stage = None
            run.error = f"Failed to enqueue DSL generation run: {exc}"
            run.updated_at = utc_now_iso()
            self._append_event(run, "run", "failed", "DSL generation run failed to enqueue.")
            self._save_run(run)
            raise
        return run

    def get_run(
        self,
        run_id: str,
        *,
        account_id: str | None = None,
        tenant_id: str | None = None,
    ) -> AppDslAgentRun | None:
        run = self._load_run(run_id)
        if not run:
            return None
        if self._is_run_expired(run):
            return None
        if not self._can_read_run(run, account_id=account_id, tenant_id=tenant_id):
            return None
        return run

    def execute_run(self, run_id: str) -> bool:
        run = self._load_run(run_id)
        if not run:
            return False
        if self._is_run_expired(run):
            return False

        try:
            args = self._generate_args_from_request(run.request)
        except Exception as exc:
            run.status = DSL_AGENT_RUN_STATUS_FAILED
            run.current_stage = None
            run.error = str(exc)
            run.updated_at = utc_now_iso()
            self._append_event(run, "run", "failed", "DSL generation run has invalid request data.")
            self._save_run(run)
            return False

        run.status = DSL_AGENT_RUN_STATUS_RUNNING
        run.updated_at = utc_now_iso()
        self._append_event(run, "run", "running", "DSL generation run started.")
        self._save_run(run)

        def progress(stage: str, status: str, message: str) -> None:
            if status == "running":
                run.current_stage = stage
            run.updated_at = utc_now_iso()
            self._append_event(run, stage, status, message)
            self._save_run(run)

        try:
            result = AppDslAgentService().generate(args, progress=progress)
            run.status = DSL_AGENT_RUN_STATUS_SUCCEEDED
            run.current_stage = None
            run.result = result
            run.updated_at = utc_now_iso()
            self._append_event(run, "run", "succeeded", "DSL generation run completed.")
            self._save_run(run)
            return True
        except Exception as exc:
            run.status = DSL_AGENT_RUN_STATUS_FAILED
            run.current_stage = None
            run.error = str(exc)
            run.updated_at = utc_now_iso()
            self._append_event(run, "run", "failed", "DSL generation run failed.")
            self._save_run(run)
            return False

    def fail_run(self, run_id: str, error: str, *, message: str = "DSL generation run failed.") -> bool:
        run = self._load_run(run_id)
        if not run:
            return False
        if self._is_run_expired(run):
            return False
        run.status = DSL_AGENT_RUN_STATUS_FAILED
        run.current_stage = None
        run.error = error
        run.updated_at = utc_now_iso()
        self._append_event(run, "run", "failed", message)
        self._save_run(run)
        return True

    def _append_event(self, run: AppDslAgentRun, stage: str, status: str, message: str) -> None:
        run.events.append(
            AppDslAgentRunEvent(
                sequence=len(run.events) + 1,
                stage=stage,
                status=status,
                message=message,
                created_at=utc_now_iso(),
            )
        )

    def _is_run_expired(self, run: AppDslAgentRun) -> bool:
        try:
            updated_at = datetime.fromisoformat(run.updated_at)
        except ValueError:
            return False
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        return datetime.now(UTC) - updated_at > self._ttl_delta

    def _can_read_run(
        self,
        run: AppDslAgentRun,
        *,
        account_id: str | None = None,
        tenant_id: str | None = None,
    ) -> bool:
        if run.account_id and run.account_id != account_id:
            return False
        if run.tenant_id and run.tenant_id != tenant_id:
            return False
        return True

    def _save_run(self, run: AppDslAgentRun) -> None:
        self._get_redis_client().setex(
            self._redis_key(run.id),
            self._ttl_seconds,
            json.dumps(_serialize_run_for_store(run), ensure_ascii=False),
        )

    def _load_run(self, run_id: str) -> AppDslAgentRun | None:
        payload = self._get_redis_client().get(self._redis_key(run_id))
        if not payload:
            return None
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        try:
            data = json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        run = _deserialize_run(data)
        if not run.id:
            return None
        return run

    def _get_redis_client(self) -> Any:
        if self._redis_client is not None:
            return self._redis_client
        from extensions.ext_redis import redis_client

        return redis_client

    def _generate_args_from_request(self, request: dict) -> AppDslAgentGenerateArgs:
        if not isinstance(request, dict):
            raise ValueError("DSL generation request payload is missing.")
        prompt = str(request.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("DSL generation prompt is missing.")
        resolve_dependencies = request.get("resolve_dependencies", True)
        if not isinstance(resolve_dependencies, bool):
            resolve_dependencies = True
        return AppDslAgentGenerateArgs(
            prompt=prompt,
            app_name=self._optional_string(request.get("app_name")),
            app_description=self._optional_string(request.get("app_description")),
            provider=str(request.get("provider") or DEFAULT_MODEL_PROVIDER),
            model=str(request.get("model") or DEFAULT_MODEL_NAME),
            generation_backend=self._optional_string(request.get("generation_backend")),
            generation_model=self._optional_string(request.get("generation_model")),
            input_variable=str(request.get("input_variable") or DEFAULT_INPUT_VARIABLE),
            marketplace_plugin_id=self._optional_string(request.get("marketplace_plugin_id")),
            resolve_dependencies=resolve_dependencies,
        )

    def _optional_string(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _redis_key(self, run_id: str) -> str:
        return f"{DSL_AGENT_RUN_REDIS_KEY_PREFIX}{run_id}"


app_dsl_agent_run_store = AppDslAgentRunStore()
