from types import SimpleNamespace

import pytest
import yaml

from services import app_dsl_agent_service
from services.app_dsl_agent_service import (
    AppDslAgentDebugRunArgs,
    AppDslAgentDebugService,
    AppDslAgentGenerateArgs,
    AppDslAgentRepairArgs,
    AppDslAgentRunStore,
    AppDslAgentService,
    DslAgentOrchestrator,
    format_stream_result,
    serialize_run,
)


class _Dependency:
    def __init__(self, data: dict):
        self.data = data

    def model_dump(self, mode: str = "python"):
        return self.data


class _FakeRedis:
    def __init__(self):
        self.values = {}
        self.ttls = {}

    def setex(self, key, ttl, value):
        self.values[key] = value
        self.ttls[key] = ttl

    def get(self, key):
        return self.values.get(key)


def _create_inline_run_store(*, redis_client: _FakeRedis | None = None, ttl_seconds: int = 3600) -> AppDslAgentRunStore:
    fake_redis = redis_client or _FakeRedis()
    store_holder = {}

    def enqueue(run_id: str) -> None:
        store_holder["store"].execute_run(run_id)

    store = AppDslAgentRunStore(redis_client=fake_redis, ttl_seconds=ttl_seconds, enqueue_run=enqueue)
    store_holder["store"] = store
    return store


@pytest.fixture(autouse=True)
def reset_dsl_agent_resolver_cache():
    DslAgentOrchestrator._plugin_resolver_instance = None
    yield
    DslAgentOrchestrator._plugin_resolver_instance = None


def test_generate_builds_importable_workflow_yaml(monkeypatch):
    dependency = {
        "type": "marketplace",
        "value": {
            "marketplace_plugin_unique_identifier": "langgenius/openai:1.0.0@abc",
            "version": "1.0.0",
        },
        "current_identifier": None,
    }
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [_Dependency(dependency)],
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt="Summarize the supplied text.",
            app_name="Summarizer",
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
        )
    )

    data = yaml.safe_load(result.yaml_content)

    assert data["kind"] == "app"
    assert data["version"] == "0.6.0"
    assert data["app"]["name"] == "Summarizer"
    assert data["dependencies"] == [dependency]

    nodes = {node["id"]: node for node in data["workflow"]["graph"]["nodes"]}
    assert nodes["start"]["data"]["variables"][0]["variable"] == "input"
    assert nodes["llm"]["data"]["model"] == {
        "completion_params": {"temperature": 0.2},
        "mode": "chat",
        "name": "gpt-4o-mini",
        "provider": "langgenius/openai/openai",
    }
    assert "Summarize the supplied text." in nodes["llm"]["data"]["prompt_template"][0]["text"]
    assert result.metadata["dependency_count"] == 1
    assert result.metadata["backend"] == "deterministic_starter"
    assert result.metadata["plan"]["graph_plan"]["nodes"][1] == {"id": "llm", "type": "llm"}
    assert result.metadata["source_evidence"]["model_provider"]["plugin_id"] == "langgenius/openai"
    assert result.metadata["validation"] == {"valid": True, "issues": []}
    assert result.metadata["repair"]["backend"] == "not_needed"


def test_deterministic_starter_builds_classifier_graph(monkeypatch):
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [],
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt=(
                "Build a workflow that classifies a support ticket as billing, "
                "technical, account, or other, then returns the category and a short reasoning."
            ),
            provider="langgenius/openai/openai",
            model="gpt-4.1",
            resolve_dependencies=False,
        )
    )
    data = yaml.safe_load(result.yaml_content)
    nodes = {node["id"]: node for node in data["workflow"]["graph"]["nodes"]}
    edges = data["workflow"]["graph"]["edges"]

    assert nodes["classify"]["type"] == "question-classifier"
    assert [item["id"] for item in nodes["classify"]["data"]["classes"]] == [
        "billing",
        "technical",
        "account",
        "other",
    ]
    assert {"billing", "technical", "account", "other"}.issubset(
        {edge["sourceHandle"] for edge in edges if edge["source"] == "classify"}
    )
    assert result.metadata["validation"]["valid"] is True


def test_deterministic_starter_builds_if_else_graph(monkeypatch):
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [],
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt=(
                "Build a workflow that checks if the incoming customer message is urgent. "
                "If urgent, produce an escalation note. Otherwise produce a normal support reply."
            ),
            provider="langgenius/openai/openai",
            model="gpt-4.1",
            resolve_dependencies=False,
        )
    )
    data = yaml.safe_load(result.yaml_content)
    nodes = {node["id"]: node for node in data["workflow"]["graph"]["nodes"]}
    edges = data["workflow"]["graph"]["edges"]

    assert nodes["if_else"]["type"] == "if-else"
    assert nodes["if_else"]["data"]["cases"][0]["case_id"] == "true"
    assert {"true", "false"}.issubset({edge["sourceHandle"] for edge in edges if edge["source"] == "if_else"})
    assert result.metadata["validation"]["valid"] is True


def test_deterministic_starter_builds_rag_graph(monkeypatch):
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [],
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt="Build a RAG workflow that retrieves knowledge base chunks and answers with citations.",
            provider="langgenius/openai/openai",
            model="gpt-4.1",
            resolve_dependencies=False,
        )
    )
    data = yaml.safe_load(result.yaml_content)
    nodes = {node["id"]: node for node in data["workflow"]["graph"]["nodes"]}

    assert nodes["retrieve_knowledge"]["type"] == "knowledge-retrieval"
    assert nodes["retrieve_knowledge"]["data"]["dataset_ids"] == ["REPLACE_WITH_DATASET_ID"]
    assert "{{#retrieve_knowledge.result#}}" in nodes["llm"]["data"]["prompt_template"][1]["text"]
    assert result.metadata["validation"]["valid"] is True


def test_generate_uses_core_dsl_agent_modules(monkeypatch):
    class FakePluginResolver:
        def resolve(self, request: str, limit: int = 8):
            return {
                "resolution_policy": ["Prefer official Dify plugins."],
                "official_candidates": [
                    {
                        "plugin_id": "langgenius/openai",
                        "source": "official",
                        "package_identity": "langgenius/openai:1.0.0@abc",
                        "exact_dependency_evidence": [],
                    }
                ],
                "model_provider_candidates": [],
                "extracted_template_candidates": [],
                "official_template_links": [],
            }

    class FakeShapeNormalizerModule:
        @staticmethod
        def normalize_shape_yaml_text(yaml_text: str):
            return yaml_text, {"changed": False, "fixes": [], "errors": []}

    class FakeDependencyNormalizerModule:
        @staticmethod
        def normalize_yaml_text(yaml_text: str, plugin_evidence: dict):
            return yaml_text, {
                "changed": False,
                "added": [],
                "already_present": [],
                "skipped": [],
                "errors": [],
                "official_candidate_count": len(plugin_evidence.get("official_candidates") or []),
            }

    class FakeValidationReport:
        def to_dict(self):
            return {"valid": True, "issues": [{"severity": "warning", "code": "fake_warning", "message": "ok"}]}

    class FakeValidatorModule:
        @staticmethod
        def validate_yaml_text(yaml_text: str):
            return FakeValidationReport()

    class FakeSourceContextCollector:
        def collect(self, plan: dict):
            return {
                "dsl_facts": {
                    "current_app_dsl_version": "0.6.0",
                    "facts": ["fake source fact"],
                },
                "node_types": ["start", "llm", "end"],
                "snippets": [
                    {"path": "/tmp/llm/entities.py", "snippet": "class LLMNode: ..."},
                ],
            }

    monkeypatch.setattr(app_dsl_agent_service.dsl_plugin_resolver, "PluginResolver", FakePluginResolver)
    monkeypatch.setattr(app_dsl_agent_service.dsl_source_context, "SourceContextCollector", FakeSourceContextCollector)
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_shape_normalizer,
        "normalize_shape_yaml_text",
        FakeShapeNormalizerModule.normalize_shape_yaml_text,
    )
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_dependency_normalizer,
        "normalize_yaml_text",
        FakeDependencyNormalizerModule.normalize_yaml_text,
    )
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_validator,
        "validate_yaml_text",
        FakeValidatorModule.validate_yaml_text,
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt="Summarize the supplied text.",
            provider="langgenius/openai/openai",
            resolve_dependencies=False,
        )
    )

    assert result.metadata["source_evidence"]["plugin_resolver"] == {
        "backend": "core.dsl_agent.plugin_resolver",
        "official_candidates_count": 1,
        "model_provider_candidates_count": 0,
        "extracted_template_candidates_count": 0,
        "official_template_links_count": 0,
    }
    assert result.metadata["source_evidence"]["source_context"] == {
        "backend": "core.dsl_agent.source_context",
        "current_app_dsl_version": "0.6.0",
        "facts": ["fake source fact"],
        "node_types": ["start", "llm", "end"],
        "snippet_count": 1,
        "snippet_paths": ["/tmp/llm/entities.py"],
    }
    assert result.metadata["normalization"]["normalizers"][0]["backend"] == "core.dsl_agent.shape_normalizer"
    assert result.metadata["normalization"]["normalizers"][1]["backend"] == "core.dsl_agent.dependency_normalizer"
    assert result.metadata["normalization"]["normalizers"][1]["report"]["official_candidate_count"] == 1
    assert result.metadata["validation"] == {
        "valid": True,
        "issues": [{"severity": "warning", "code": "fake_warning", "message": "ok"}],
    }


def test_source_context_prompt_compaction():
    source_context = {
        "source_policy": ["Prefer local Dify source."],
        "dsl_facts": {
            "current_app_dsl_version": "0.6.0",
            "facts": ["fact"] * 12,
        },
        "node_types": ["llm"],
        "snippets": [
            {"node_type": "llm", "path": f"/tmp/{index}.py", "snippet": "x" * 5000}
            for index in range(8)
        ],
    }

    compact = app_dsl_agent_service.dsl_generation.compact_source_context_for_prompt(source_context)

    assert len(compact["snippets"]) == 6
    assert all(len(snippet["snippet"]) < 1400 for snippet in compact["snippets"])
    assert compact["dsl_facts"]["facts"] == ["fact"] * 8


def test_generate_can_use_openai_backend_without_real_network(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(DslAgentOrchestrator, "_openai_client", lambda self: object())

    def fake_generate_plan(client, model: str, request: str):
        assert model == "gpt-test"
        assert "Preferred model provider: langgenius/openai/openai" in request
        return {
            "app": {
                "name": "LLM Planned App",
                "mode": "workflow",
                "description": "LLM planned description.",
            },
            "requirements": {
                "goal": "test",
                "inputs": ["input"],
                "outputs": ["answer"],
                "needs_plugins": ["langgenius/openai"],
            },
            "graph_plan": {
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "llm", "type": "llm"},
                    {"id": "end", "type": "end"},
                ],
                "edges": [
                    {"source": "start", "target": "llm"},
                    {"source": "llm", "target": "end"},
                ],
            },
        }

    def fake_compact_plugin_evidence_for_prompt(plugin_evidence: dict, plan: dict):
        return plugin_evidence

    def fake_generate_yaml(
        *,
        client,
        model: str,
        request: str,
        plan: dict,
        plugin_evidence: dict,
        source_context: dict,
    ):
        assert model == "gpt-test"
        return """
app:
  description: LLM generated description.
  mode: workflow
  name: LLM Generated App
dependencies: []
kind: app
version: "0.6.0"
workflow:
  graph:
    nodes:
    - id: start
      type: start
      data:
        type: start
    - id: llm
      type: llm
      data:
        model:
          completion_params:
            temperature: 0.2
          mode: chat
          name: gpt-4o-mini
          provider: langgenius/openai/openai
        type: llm
    - id: end
      type: end
      data:
        type: end
    edges:
    - id: start-source-llm-target
      source: start
      sourceHandle: source
      target: llm
      targetHandle: target
      type: custom
      data:
        sourceType: start
        targetType: llm
    - id: llm-source-end-target
      source: llm
      sourceHandle: source
      target: end
      targetHandle: target
      type: custom
      data:
        sourceType: llm
        targetType: end
"""

    class _ValidReport:
        def to_dict(self):
            return {"valid": True, "issues": []}

    fake_plugin_evidence = {
        "resolution_policy": ["Prefer official Dify plugins."],
        "official_candidates": [
            {
                "plugin_id": "langgenius/openai",
                "source": "official",
                "package_identity": "langgenius/openai:1.0.0@abc",
                "exact_dependency_evidence": [],
            }
        ],
        "model_provider_candidates": [
            {
                "plugin_id": "langgenius/openai",
                "source": "model_provider",
                "package_identity": "langgenius/openai:1.0.0@abc",
                "exact_dependency_evidence": [],
            }
        ],
        "extracted_template_candidates": [],
        "official_template_links": [],
    }

    monkeypatch.setattr(
        DslAgentOrchestrator,
        "_get_plugin_resolver",
        lambda self: SimpleNamespace(resolve=lambda request, limit=6: fake_plugin_evidence),
    )
    monkeypatch.setattr(app_dsl_agent_service.dsl_generation, "generate_plan", fake_generate_plan)
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_generation,
        "compact_plugin_evidence_for_prompt",
        fake_compact_plugin_evidence_for_prompt,
    )
    monkeypatch.setattr(app_dsl_agent_service.dsl_generation, "generate_yaml", fake_generate_yaml)
    # This test exercises the OpenAI backend wiring and result metadata, not the
    # validator; keep validation deterministic so it stays focused on backend
    # selection (the validator has its own dedicated unit tests).
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_validator,
        "validate_yaml_text",
        lambda yaml_text: _ValidReport(),
    )

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt="Build an LLM generated workflow.",
            provider="langgenius/openai/openai",
            generation_backend="openai",
            generation_model="gpt-test",
            resolve_dependencies=False,
        )
    )

    assert result.name == "LLM Generated App"
    assert result.description == "LLM generated description."
    assert result.metadata["backend"] == "openai"
    assert result.metadata["generation"] == {
        "backend": "openai",
        "model": "gpt-test",
        "prompt_plugin_candidates": {
            "official_candidates_count": 1,
            "model_provider_candidates_count": 1,
            "extracted_template_candidates_count": 0,
            "official_template_links_count": 0,
        },
    }


def test_openai_yaml_extractor_preserves_code_fence_regex():
    yaml_text = """version: "0.6.0"
kind: app
workflow:
  graph:
    nodes:
    - data:
        code: |
          cleaned = re.sub(r"```(?:json)?\\s*", "", text)
        type: code
"""

    extracted = app_dsl_agent_service.dsl_generation.extract_yaml(yaml_text)

    assert extracted == yaml_text
    assert 're.sub(r"```(?:json)?\\s*"' in extracted


def test_format_stream_result_extracts_workflow_runtime_errors():
    raw = "\n".join(
        [
            "event: workflow_started",
            'data: {"id": "run-1", "task_id": "task-1"}',
            "",
            "event: node_finished",
            'data: {"node_id": "llm", "node_type": "llm", "title": "Reason", '
            '"status": "failed", "error": "model credential missing", "elapsed_time": 0.2}',
            "",
            "event: workflow_finished",
            'data: {"status": "failed", "error": "workflow failed"}',
            "",
        ]
    )

    result = format_stream_result(raw, include_events=True)

    assert result["event_count"] == 3
    assert result["summary"]["workflow_run_id"] == "run-1"
    assert result["summary"]["task_id"] == "task-1"
    assert result["summary"]["succeeded"] is False
    assert result["summary"]["failed_nodes"] == [
        {
            "node_id": "llm",
            "node_type": "llm",
            "title": "Reason",
            "status": "failed",
            "error": "model credential missing",
            "elapsed_time": 0.2,
        }
    ]
    assert result["events"][0]["sse_event"] == "workflow_started"


def test_format_stream_result_summarizes_blocking_draft_run_payload():
    raw = (
        'data: {"task_id": "task-1", "workflow_run_id": "run-1", '
        '"data": {"id": "run-1", "status": "succeeded", '
        '"outputs": {"answer": "ok"}, "error": null, "elapsed_time": 1.2, "total_steps": 4}}\n\n'
    )

    result = format_stream_result(raw, include_events=True)

    assert result["event_count"] == 1
    assert result["summary"]["task_id"] == "task-1"
    assert result["summary"]["workflow_run_id"] == "run-1"
    assert result["summary"]["status"] == "succeeded"
    assert result["summary"]["succeeded"] is True
    assert result["summary"]["outputs"] == {"answer": "ok"}


def test_debug_service_runs_draft_workflow_and_summarizes_sse(monkeypatch):
    from models.model import AppMode
    from services.app_generate_service import AppGenerateService

    calls = []

    def fake_generate(**kwargs):
        calls.append(kwargs)
        yield 'event: workflow_started\ndata: {"id": "run-2"}\n\n'
        yield 'event: workflow_finished\ndata: {"status": "succeeded", "outputs": {"answer": "ok"}}\n\n'

    monkeypatch.setattr(AppGenerateService, "generate", fake_generate)

    result = AppDslAgentDebugService().run_draft_workflow(
        app_model=SimpleNamespace(mode=AppMode.WORKFLOW),
        account=SimpleNamespace(id="account-1"),
        args=AppDslAgentDebugRunArgs(inputs={"input": "hello"}),
    )

    assert calls[0]["args"] == {"inputs": {"input": "hello"}}
    assert calls[0]["streaming"] is False
    assert result["summary"]["workflow_run_id"] == "run-2"
    assert result["summary"]["succeeded"] is True
    assert result["summary"]["outputs"] == {"answer": "ok"}
    assert "events" not in result


def test_debug_service_repairs_yaml_from_runtime_evidence(monkeypatch):
    runtime_evidence = {
        "summary": {
            "failed_nodes": [
                {
                    "node_id": "code",
                    "node_type": "code",
                    "status": "failed",
                    "error": "intentional runtime failure",
                }
            ]
        }
    }

    class FakeValidationReport:
        def __init__(self, valid=True):
            self.valid = valid

        def to_dict(self):
            return {"valid": self.valid, "issues": []}

    class FakeRepairModule:
        @staticmethod
        def repair_yaml_text(yaml_text: str, *, validation=None, runtime_evidence=None):
            assert validation == {"valid": True, "issues": []}
            assert runtime_evidence == {
                "summary": {
                    "failed_nodes": [
                        {
                            "node_id": "code",
                            "node_type": "code",
                            "status": "failed",
                            "error": "intentional runtime failure",
                        }
                    ]
                }
            }
            return yaml_text.replace("raise Exception('broken')", "return {'result': input}"), {
                "changed": True,
                "fixes": [{"type": "runtime_code_node_failed", "node_id": "code"}],
                "errors": [],
            }

    class FakeValidatorModule:
        @staticmethod
        def validate_yaml_text(yaml_text: str):
            return FakeValidationReport(valid="raise Exception('broken')" not in yaml_text)

    monkeypatch.setattr(
        app_dsl_agent_service.dsl_deterministic_repair,
        "repair_yaml_text",
        FakeRepairModule.repair_yaml_text,
    )
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_validator,
        "validate_yaml_text",
        FakeValidatorModule.validate_yaml_text,
    )

    result = AppDslAgentDebugService().repair_yaml(
        AppDslAgentRepairArgs(
            yaml_content="code: raise Exception('broken')",
            runtime_evidence=runtime_evidence,
            validation={"valid": True, "issues": []},
        )
    )

    assert result["changed"] is True
    assert result["yaml_content"] == "code: return {'result': input}"
    assert result["input_validation"] == {"valid": True, "issues": []}
    assert result["validation"] == {"valid": True, "issues": []}
    assert result["repair"]["backend"] == "core.dsl_agent.deterministic_repair"
    assert result["repair"]["fixes"] == [{"type": "runtime_code_node_failed", "node_id": "code"}]


def test_debug_service_runs_draft_then_repairs_from_runtime_evidence(monkeypatch):
    from models.model import AppMode
    from services.app_generate_service import AppGenerateService

    def fake_generate(**kwargs):
        yield 'event: workflow_started\ndata: {"id": "run-3"}\n\n'
        yield (
            "event: node_finished\n"
            'data: {"node_id": "code", "node_type": "code", "title": "Transform", '
            '"status": "failed", "error": "intentional runtime failure"}\n\n'
        )
        yield 'event: workflow_finished\ndata: {"status": "failed", "error": "workflow failed"}\n\n'

    class FakeValidationReport:
        def to_dict(self):
            return {"valid": True, "issues": []}

    runtime_evidence_calls = []

    class FakeRepairModule:
        @staticmethod
        def repair_yaml_text(yaml_text: str, *, validation=None, runtime_evidence=None):
            runtime_evidence_calls.append(runtime_evidence)
            return yaml_text.replace("broken_code", "fixed_code"), {
                "changed": True,
                "fixes": [{"type": "runtime_code_node_failed", "node_id": "code"}],
                "errors": [],
            }

    class FakeValidatorModule:
        @staticmethod
        def validate_yaml_text(yaml_text: str):
            return FakeValidationReport()

    monkeypatch.setattr(AppGenerateService, "generate", fake_generate)
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_deterministic_repair,
        "repair_yaml_text",
        FakeRepairModule.repair_yaml_text,
    )
    monkeypatch.setattr(
        app_dsl_agent_service.dsl_validator,
        "validate_yaml_text",
        FakeValidatorModule.validate_yaml_text,
    )

    result = AppDslAgentDebugService().run_draft_workflow_and_repair(
        app_model=SimpleNamespace(mode=AppMode.WORKFLOW),
        account=SimpleNamespace(id="account-1"),
        yaml_content="code: broken_code",
        args=AppDslAgentDebugRunArgs(inputs={"input": "hello"}),
    )

    assert result["needs_repair"] is True
    assert result["draft_run"]["summary"]["workflow_run_id"] == "run-3"
    assert result["draft_run"]["summary"]["failed_nodes"][0]["node_id"] == "code"
    assert result["repair"]["changed"] is True
    assert result["repair"]["yaml_content"] == "code: fixed_code"
    assert runtime_evidence_calls[0]["draft_run"]["summary"]["failed_nodes"][0]["node_type"] == "code"


def test_generate_falls_back_to_package_identity_when_marketplace_resolution_fails(monkeypatch):
    class FakePluginResolver:
        def resolve(self, request: str, limit: int = 8):
            return {
                "resolution_policy": ["Prefer official Dify plugins."],
                "official_candidates": [
                    {
                        "plugin_id": "langgenius/anthropic",
                        "source": "official",
                        "package_identity": "langgenius/anthropic:0.2.0",
                        "exact_dependency_evidence": [],
                    }
                ],
                "model_provider_candidates": [],
                "extracted_template_candidates": [],
                "official_template_links": [],
            }

    def raise_error(_plugin_ids):
        raise RuntimeError("marketplace unavailable")

    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        raise_error,
    )
    monkeypatch.setattr(DslAgentOrchestrator, "_get_plugin_resolver", lambda self: FakePluginResolver())

    result = AppDslAgentService().generate(
        AppDslAgentGenerateArgs(
            prompt="Classify customer feedback.",
            provider="langgenius/anthropic/anthropic",
            input_variable="Customer Feedback!",
        )
    )
    data = yaml.safe_load(result.yaml_content)

    assert data["dependencies"] == [
        {
            "type": "marketplace",
            "value": {
                "marketplace_plugin_unique_identifier": "langgenius/anthropic:0.2.0",
            },
            "current_identifier": None,
        }
    ]
    assert data["workflow"]["graph"]["nodes"][0]["data"]["variables"][0]["variable"] == "customer_feedback"
    assert result.warnings == ["Could not resolve the latest marketplace package for langgenius/anthropic."]


def test_run_store_executes_generation_and_records_stage_events(monkeypatch):
    dependency = {
        "type": "marketplace",
        "value": {
            "marketplace_plugin_unique_identifier": "langgenius/openai:1.0.0@abc",
            "version": "1.0.0",
        },
        "current_identifier": None,
    }
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [_Dependency(dependency)],
    )
    store = _create_inline_run_store()

    run = store.create_run(
        AppDslAgentGenerateArgs(
            prompt="Summarize the supplied text.",
            app_name="Summarizer",
        )
    )
    payload = serialize_run(store.get_run(run.id))

    assert payload["status"] == "succeeded"
    assert payload["result"]["name"] == "Summarizer"
    assert payload["result"]["metadata"]["dependency_count"] == 1
    assert [event["stage"] for event in payload["events"]] == [
        "queued",
        "run",
        "plan",
        "plan",
        "source_evidence",
        "source_evidence",
        "resolve_dependencies",
        "resolve_dependencies",
        "generate",
        "generate",
        "normalize",
        "normalize",
        "validate",
        "validate",
        "repair",
        "run",
    ]
    assert payload["events"][-1]["status"] == "succeeded"


def test_run_store_persists_runs_for_cross_worker_polling(monkeypatch):
    fake_redis = _FakeRedis()
    enqueued_run_ids = []
    monkeypatch.setattr(
        app_dsl_agent_service.DependenciesAnalysisService,
        "generate_latest_dependencies",
        lambda _plugin_ids: [],
    )

    writer_store = AppDslAgentRunStore(redis_client=fake_redis, ttl_seconds=3600, enqueue_run=enqueued_run_ids.append)
    worker_store = AppDslAgentRunStore(redis_client=fake_redis, ttl_seconds=3600, enqueue_run=lambda _run_id: None)
    reader_store = AppDslAgentRunStore(redis_client=fake_redis, ttl_seconds=3600, enqueue_run=lambda _run_id: None)

    run = writer_store.create_run(
        AppDslAgentGenerateArgs(prompt="Summarize the supplied text."),
        account_id="account-1",
        tenant_id="tenant-1",
    )

    redis_key = f"{app_dsl_agent_service.DSL_AGENT_RUN_REDIS_KEY_PREFIX}{run.id}"
    assert enqueued_run_ids == [run.id]
    assert redis_key in fake_redis.values
    assert fake_redis.ttls[redis_key] == 3600

    queued = reader_store.get_run(run.id, account_id="account-1", tenant_id="tenant-1")
    assert queued is not None
    assert queued.status == "queued"

    assert worker_store.execute_run(run.id) is True

    restored = reader_store.get_run(run.id, account_id="account-1", tenant_id="tenant-1")
    assert restored is not None
    assert restored.id == run.id
    assert restored.status == "succeeded"

    assert reader_store.get_run(run.id, account_id="account-2", tenant_id="tenant-1") is None
    assert reader_store.get_run(run.id, account_id="account-1", tenant_id="tenant-2") is None


def test_run_store_records_generation_failures(monkeypatch):
    def raise_error(self, args, progress=None):
        if progress:
            progress("generate", "running", "Generating Dify DSL YAML.")
        raise RuntimeError("generation failed")

    monkeypatch.setattr(AppDslAgentService, "generate", raise_error)
    store = _create_inline_run_store()

    run = store.create_run(AppDslAgentGenerateArgs(prompt="Broken workflow."))
    payload = serialize_run(store.get_run(run.id))

    assert payload["status"] == "failed"
    assert payload["error"] == "generation failed"
    assert payload["result"] is None
    assert payload["events"][-1]["status"] == "failed"


def test_run_store_can_mark_run_failed_without_worker_context():
    fake_redis = _FakeRedis()
    enqueued_run_ids = []
    store = AppDslAgentRunStore(redis_client=fake_redis, ttl_seconds=3600, enqueue_run=enqueued_run_ids.append)

    run = store.create_run(AppDslAgentGenerateArgs(prompt="Slow workflow."))
    assert enqueued_run_ids == [run.id]

    assert store.fail_run(run.id, "timed out", message="DSL generation run timed out.") is True
    payload = serialize_run(store.get_run(run.id))

    assert payload["status"] == "failed"
    assert payload["error"] == "timed out"
    assert payload["events"][-1]["message"] == "DSL generation run timed out."


def test_celery_task_executes_dsl_agent_run_store(monkeypatch):
    from tasks import app_dsl_agent_generate_task

    calls = []

    def execute_run(run_id: str) -> bool:
        calls.append(run_id)
        return True

    monkeypatch.setattr(app_dsl_agent_generate_task.app_dsl_agent_run_store, "execute_run", execute_run)

    assert app_dsl_agent_generate_task.run_app_dsl_agent_generation_task.run("run-1") is True
    assert calls == ["run-1"]


def test_celery_task_marks_soft_timeout_failed(monkeypatch):
    from billiard.exceptions import SoftTimeLimitExceeded

    from tasks import app_dsl_agent_generate_task

    calls = []

    def execute_run(run_id: str) -> bool:
        calls.append(("execute", run_id))
        raise SoftTimeLimitExceeded()

    def fail_run(run_id: str, error: str, *, message: str) -> bool:
        calls.append(("fail", run_id, error, message))
        return True

    monkeypatch.setattr(app_dsl_agent_generate_task.app_dsl_agent_run_store, "execute_run", execute_run)
    monkeypatch.setattr(app_dsl_agent_generate_task.app_dsl_agent_run_store, "fail_run", fail_run)

    assert app_dsl_agent_generate_task.run_app_dsl_agent_generation_task.run("run-1") is False
    assert calls == [
        ("execute", "run-1"),
        (
            "fail",
            "run-1",
            "DSL generation timed out. Try again or choose a faster generation model.",
            "DSL generation run timed out.",
        ),
    ]
