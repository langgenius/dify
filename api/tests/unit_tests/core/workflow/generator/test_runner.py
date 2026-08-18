"""
Unit tests for ``WorkflowGenerator``.

The runner is pure domain logic — we mock the injected ``model_instance`` and
assert that the postprocessor produces a structurally valid graph for both
Workflow and Advanced-Chat modes, plus that obvious failure paths surface a
readable error envelope.
"""

import json
import threading
import time
from copy import deepcopy
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from jinja2 import Template

from configs import dify_config
from core.workflow.generator.runner import WorkflowGenerator
from core.workflow.generator.types import GraphDict


def _llm_result(text: str) -> MagicMock:
    """Build a stand-in for ``LLMResult`` that the runner only reads as text."""
    result = MagicMock()
    result.message.get_text_content.return_value = text
    return result


class _GraphFixtureModel:
    """Adapt full-graph fixtures to the production per-node model protocol."""

    def __init__(self, planner: str, graph: str) -> None:
        planner_payload = json.loads(planner)
        graph_payload = json.loads(graph)
        graph_nodes = [node for node in graph_payload.get("nodes", []) if isinstance(node, dict)]
        used_indexes: set[int] = set()
        graph_node_by_plan_id: dict[str, dict[str, Any]] = {}

        for plan_node in planner_payload.get("nodes", []):
            plan_type = plan_node.get("node_type")
            plan_label = plan_node.get("label")
            match_index = next(
                (
                    index
                    for index, graph_node in enumerate(graph_nodes)
                    if index not in used_indexes
                    and isinstance(graph_node.get("data"), dict)
                    and graph_node["data"].get("type") == plan_type
                    and graph_node["data"].get("title") == plan_label
                ),
                None,
            )
            if match_index is None:
                match_index = next(
                    (
                        index
                        for index, graph_node in enumerate(graph_nodes)
                        if index not in used_indexes
                        and isinstance(graph_node.get("data"), dict)
                        and graph_node["data"].get("type") == plan_type
                    ),
                    None,
                )
            if match_index is None:
                continue
            used_indexes.add(match_index)
            graph_node = graph_nodes[match_index]
            node_id = str(graph_node.get("id") or "")
            plan_node["id"] = node_id
            if graph_node.get("parentId"):
                plan_node["parent"] = str(graph_node["parentId"])
            graph_node_by_plan_id[node_id] = graph_node

        plan_ids = {str(node.get("id") or "") for node in planner_payload.get("nodes", [])}
        planner_payload["edges"] = [
            {key: edge[key] for key in ("source", "target", "sourceHandle", "targetHandle") if key in edge}
            for edge in graph_payload.get("edges", [])
            if isinstance(edge, dict) and edge.get("source") in plan_ids and edge.get("target") in plan_ids
        ]

        self._planner = planner_payload
        self._graph_node_by_plan_id = graph_node_by_plan_id
        self.invoke_llm = MagicMock(side_effect=self._invoke)

    def _invoke(self, *, prompt_messages, model_parameters, stream):
        system_prompt = str(prompt_messages[0].content)
        if "workflow planner" in system_prompt.lower():
            return _llm_result(json.dumps(self._planner))

        prompt = "\n".join(str(message.content) for message in prompt_messages)
        node_id = next(node_id for node_id in self._graph_node_by_plan_id if f"id={node_id}, type=" in prompt)
        data = deepcopy(self._graph_node_by_plan_id[node_id].get("data") or {})
        for shared_key in ("type", "title", "desc", "selected"):
            data.pop(shared_key, None)
        return _llm_result(json.dumps({"config": data}))


class _ParallelBuilderModel:
    """Thread-safe fake that blocks the first ``barrier_parties`` node builders together."""

    def __init__(
        self,
        planner: dict[str, Any],
        configs: dict[str, dict[str, Any]],
        *,
        invalid_node_id: str | None = None,
        barrier_parties: int | None = None,
    ) -> None:
        self._planner = planner
        self._configs = configs
        self._invalid_node_id = invalid_node_id
        self._barrier_parties = barrier_parties if barrier_parties is not None else (2 if len(configs) >= 2 else 0)
        self._barrier = threading.Barrier(self._barrier_parties) if self._barrier_parties >= 2 else None
        self._lock = threading.Lock()
        self._builder_calls = 0
        self._calls_by_node: dict[str, int] = {}
        self._active_builders = 0
        self.max_active_builders = 0
        self.planner_calls = 0
        self.planner_prompt_messages: list[Any] = []

    @property
    def builder_calls(self) -> int:
        return self._builder_calls

    def calls_for(self, node_id: str) -> int:
        return self._calls_by_node.get(node_id, 0)

    def invoke_llm(self, *, prompt_messages, model_parameters, stream):
        system_prompt = str(prompt_messages[0].content)
        if "workflow planner" in system_prompt.lower():
            with self._lock:
                self.planner_calls += 1
                self.planner_prompt_messages = list(prompt_messages)
            return _llm_result(json.dumps(self._planner))

        user_prompt = "\n".join(str(message.content) for message in prompt_messages)
        node_id = next(node_id for node_id in self._configs if f"id={node_id}" in user_prompt)
        with self._lock:
            call_index = self._builder_calls
            self._builder_calls += 1
            self._calls_by_node[node_id] = self._calls_by_node.get(node_id, 0) + 1
            self._active_builders += 1
            self.max_active_builders = max(self.max_active_builders, self._active_builders)
        try:
            if self._barrier is not None and call_index < self._barrier_parties:
                self._barrier.wait(timeout=2)
            if node_id == self._invalid_node_id:
                return _llm_result("not a json object")
            return _llm_result(json.dumps({"config": self._configs[node_id]}))
        finally:
            with self._lock:
                self._active_builders -= 1


class TestParallelNodeBuilder:
    def test_builder_concurrency_caps_at_configured_workers(self, monkeypatch):
        monkeypatch.setattr(dify_config, "WORKFLOW_GENERATOR_NODE_BUILDER_MAX_WORKERS", 2)
        planner = {
            "title": "URL Summarizer",
            "description": "Summarize a URL.",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Receive URL."},
                {"id": "node2", "label": "Summarize", "node_type": "llm", "purpose": "Summarize it."},
                {"id": "node3", "label": "End", "node_type": "end", "purpose": "Return summary."},
            ],
            "edges": [
                {"source": "node1", "target": "node2"},
                {"source": "node2", "target": "node3"},
            ],
        }
        model = _ParallelBuilderModel(
            planner,
            {
                "node1": {
                    "variables": [
                        {
                            "variable": "url",
                            "label": "URL",
                            "type": "text-input",
                            "required": True,
                            "max_length": 256,
                            "options": [],
                        }
                    ]
                },
                "node2": {
                    "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "user", "text": "Summarize {{#node1.url#}}"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                },
                "node3": {"outputs": [{"variable": "summary", "value_selector": ["node2", "text"]}]},
            },
        )

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert result["error"] == ""
        assert model.builder_calls == 3
        assert model.max_active_builders == 2
        assert [node["data"]["type"] for node in result["graph"]["nodes"]] == ["start", "llm", "end"]
        assert [edge["source"] for edge in result["graph"]["edges"]] == ["node1", "node2"]

    def test_higher_worker_config_runs_all_builders_in_one_wave(self, monkeypatch):
        monkeypatch.setattr(dify_config, "WORKFLOW_GENERATOR_NODE_BUILDER_MAX_WORKERS", 5)
        planner = {
            "title": "URL Summarizer",
            "description": "Summarize a URL.",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Receive URL."},
                {"id": "node2", "label": "Summarize", "node_type": "llm", "purpose": "Summarize it."},
                {"id": "node3", "label": "End", "node_type": "end", "purpose": "Return summary."},
            ],
            "edges": [
                {"source": "node1", "target": "node2"},
                {"source": "node2", "target": "node3"},
            ],
        }
        # A 3-party barrier deadlocks unless all three builders run concurrently,
        # so passing at all proves the configured cap lifted the old 2-wave limit.
        model = _ParallelBuilderModel(
            planner,
            {
                "node1": {"variables": []},
                "node2": {
                    "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "user", "text": "Summarize {{#sys.query#}}"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                },
                "node3": {"outputs": [{"variable": "summary", "value_selector": ["node2", "text"]}]},
            },
            barrier_parties=3,
        )

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert result["error"] == ""
        assert model.builder_calls == 3
        assert model.max_active_builders == 3

    def test_failed_builder_cancels_queued_builders(self, monkeypatch):
        # One worker: node1's builder fails immediately, node2's blocks the
        # worker briefly, node3 sits in the queue. The failure must cancel
        # node3 before the worker frees up — no LLM call for it at all.
        monkeypatch.setattr(dify_config, "WORKFLOW_GENERATOR_NODE_BUILDER_MAX_WORKERS", 1)
        planner = {
            "title": "x",
            "description": "x",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "x"},
                {"id": "node2", "label": "Mid", "node_type": "llm", "purpose": "x"},
                {"id": "node3", "label": "End", "node_type": "end", "purpose": "x"},
            ],
            "edges": [{"source": "node1", "target": "node2"}, {"source": "node2", "target": "node3"}],
        }
        builder_calls: list[str] = []

        class _FailFastModel:
            def invoke_llm(self, *, prompt_messages, model_parameters, stream):
                if "workflow planner" in str(prompt_messages[0].content).lower():
                    return _llm_result(json.dumps(planner))
                user_prompt = "\n".join(str(message.content) for message in prompt_messages)
                node_id = next(n for n in ("node1", "node2", "node3") if f"id={n}, type=" in user_prompt)
                builder_calls.append(node_id)
                if node_id == "node1":
                    raise RuntimeError("permanent provider failure")
                time.sleep(0.3)
                return _llm_result(json.dumps({"config": {}}))

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=_FailFastModel(),
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["errors"][0]["code"] == "MODEL_ERROR"
        assert "node3" not in builder_calls

    def test_builder_response_without_config_object_fails_closed(self):
        planner = {
            "title": "x",
            "description": "x",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "x"},
                {"id": "node2", "label": "End", "node_type": "end", "purpose": "x"},
            ],
            "edges": [{"source": "node1", "target": "node2"}],
        }
        # node2's response parses as JSON but carries no ``config`` object — a
        # schema error, so no JSON-repair retry fires and the graph fails closed.
        model = _ParallelBuilderModel(planner, {"node1": {"variables": []}, "node2": cast(Any, "not an object")})

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert "missing 'config' object" in result["error"]
        assert result["errors"][0]["code"] == "INVALID_SCHEMA"
        assert result["graph"]["nodes"] == []
        assert model.calls_for("node2") == 1

    def test_refine_reuses_keep_nodes_and_only_builds_updated_nodes(self):
        planner = {
            "title": "Refined Summarizer",
            "description": "Use a shorter summary prompt.",
            "nodes": [
                {
                    "id": "start_existing",
                    "label": "Start",
                    "node_type": "start",
                    "purpose": "Receive topic.",
                    "action": "keep",
                },
                {
                    "id": "llm_existing",
                    "label": "Summarize",
                    "node_type": "llm",
                    "purpose": "Return one sentence.",
                    "action": "update",
                },
                {
                    "id": "end_existing",
                    "label": "End",
                    "node_type": "end",
                    "purpose": "Return summary.",
                    "action": "keep",
                },
            ],
            "edges": [
                {"source": "start_existing", "target": "llm_existing"},
                {"source": "llm_existing", "target": "end_existing"},
            ],
        }
        model = _ParallelBuilderModel(
            planner,
            {
                "llm_existing": {
                    "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
                    "prompt_template": [
                        {"role": "user", "text": "Summarize {{#start_existing.topic#}} in one sentence."}
                    ],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            },
        )
        current_graph = {
            "nodes": [
                {
                    "id": "start_existing",
                    "type": "custom",
                    "position": {"x": 10, "y": 10},
                    "data": {
                        "type": "start",
                        "title": "Start",
                        "variables": [
                            {
                                "variable": "topic",
                                "label": "Topic",
                                "type": "paragraph",
                                "required": True,
                                "max_length": 4096,
                                "options": [],
                            }
                        ],
                    },
                },
                {
                    "id": "llm_existing",
                    "type": "custom",
                    "position": {"x": 330, "y": 10},
                    "data": {"type": "llm", "title": "Summarize", "prompt_template": []},
                },
                {
                    "id": "end_existing",
                    "type": "custom",
                    "position": {"x": 650, "y": 10},
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "summary", "value_selector": ["llm_existing", "text"]}],
                    },
                },
            ],
            "edges": [],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Make the summary one sentence",
            current_graph=current_graph,
        )

        assert result["error"] == ""
        assert model.builder_calls == 1
        start = next(node for node in result["graph"]["nodes"] if node["id"] == "start_existing")
        assert start["data"]["variables"][0]["variable"] == "topic"
        assert current_graph["nodes"][0]["position"] == {"x": 10, "y": 10}

    def test_human_input_outputs_and_action_handles_follow_main_contract(self):
        planner = {
            "title": "Approval Flow",
            "description": "Ask a person to approve.",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Start."},
                {
                    "id": "node2",
                    "label": "Review",
                    "node_type": "human-input",
                    "purpose": "Collect approval and a comment.",
                },
                {"id": "node3", "label": "End", "node_type": "end", "purpose": "Return comment."},
            ],
            "edges": [
                {"source": "node1", "target": "node2"},
                {"source": "node2", "target": "node3", "source_handle": "approve"},
            ],
        }
        model = _ParallelBuilderModel(
            planner,
            {
                "node1": {"variables": []},
                "node2": {
                    "delivery_methods": [{"id": "webapp", "type": "webapp", "enabled": True}],
                    "form_content": "Approve this request.",
                    "inputs": [
                        {
                            "type": "paragraph",
                            "output_variable_name": "comment",
                            "default": {"type": "constant", "selector": [], "value": ""},
                        }
                    ],
                    "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
                    "timeout": 3,
                    "timeout_unit": "day",
                },
                "node3": {"outputs": [{"variable": "comment", "value_selector": ["node2", "comment"]}]},
            },
        )

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Ask for approval",
        )

        assert result["error"] == ""
        review_edge = next(edge for edge in result["graph"]["edges"] if edge["source"] == "node2")
        assert review_edge["sourceHandle"] == "approve"

    def test_invalid_fragment_retries_once_then_fails_without_partial_graph(self):
        planner = {
            "title": "Minimal Flow",
            "description": "Return a fixed value.",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Start."},
                {"id": "node2", "label": "End", "node_type": "end", "purpose": "Return output."},
            ],
            "edges": [{"source": "node1", "target": "node2"}],
        }
        model = _ParallelBuilderModel(
            planner,
            {
                "node1": {"variables": []},
                "node2": {"outputs": []},
            },
            invalid_node_id="node2",
        )

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Return a fixed value",
        )

        assert result["graph"]["nodes"] == []
        assert {error["code"] for error in result["errors"]} == {"INVALID_JSON"}
        assert model.calls_for("node2") == 2

    def test_planner_schema_retries_once_then_uses_single_builder_contract(self):
        invalid_plan = {
            "title": "Minimal Flow",
            "description": "Return a fixed value.",
            "nodes": [
                {"label": "Start", "node_type": "start", "purpose": "Start."},
                {"label": "End", "node_type": "end", "purpose": "Return output."},
            ],
        }
        valid_plan = {
            **invalid_plan,
            "nodes": [
                {"id": "node1", **invalid_plan["nodes"][0]},
                {"id": "node2", **invalid_plan["nodes"][1]},
            ],
            "edges": [{"source": "node1", "target": "node2"}],
        }
        planner_calls = 0

        def invoke(*, prompt_messages, model_parameters, stream):
            nonlocal planner_calls
            system_prompt = str(prompt_messages[0].content)
            if "workflow planner" in system_prompt.lower():
                planner_calls += 1
                return _llm_result(json.dumps(invalid_plan if planner_calls == 1 else valid_plan))
            prompt = "\n".join(str(message.content) for message in prompt_messages)
            config = {"variables": []} if "id=node1, type=start" in prompt else {"outputs": []}
            return _llm_result(json.dumps({"config": config}))

        model = MagicMock()
        model.invoke_llm.side_effect = invoke

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Return a fixed value",
        )

        assert result["error"] == ""
        assert planner_calls == 2
        retry_prompt = str(model.invoke_llm.call_args_list[1].kwargs["prompt_messages"][-1].content)
        assert "required topology schema" in retry_prompt


class TestWorkflowGeneratorWorkflowMode:
    """Generation in plain ``workflow`` mode: start → llm → end."""

    @pytest.fixture
    def planner_response(self) -> str:
        return json.dumps(
            {
                "title": "URL Summarizer",
                "description": "Fetch a URL, summarize it, return the summary.",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "User submits URL."},
                    {"label": "Summarize", "node_type": "llm", "purpose": "Summarize the page."},
                    {"label": "End", "node_type": "end", "purpose": "Return summary."},
                ],
            }
        )

    @pytest.fixture
    def builder_response(self) -> str:
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "desc": "", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "desc": "",
                            "model": {
                                "provider": "openai",
                                "name": "gpt-4o",
                                "mode": "chat",
                                "completion_params": {},
                            },
                            "prompt_template": [
                                {"role": "system", "text": "You summarize URLs."},
                                {"role": "user", "text": "{{#node1.url#}}"},
                            ],
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "desc": "",
                            "outputs": [{"variable": "summary", "value_selector": ["node2", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "x", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_happy_path_returns_valid_graph(self, planner_response, builder_response):
        model_instance = _GraphFixtureModel(planner_response, builder_response)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={"temperature": 0.7},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert result["error"] == ""
        graph = result["graph"]
        node_types = [n["data"]["type"] for n in graph["nodes"]]
        assert node_types == ["start", "llm", "end"]

        # Postprocessor must lay nodes out left-to-right.
        xs = [n["position"]["x"] for n in graph["nodes"]]
        assert xs == sorted(xs)
        assert len(set(xs)) == len(xs)

        # Edges must be deduped and given a stable id.
        assert len(graph["edges"]) == 2
        ids = [e["id"] for e in graph["edges"]]
        assert len(set(ids)) == 2

        # Edge data.sourceType / targetType must be populated from node lookup.
        first_edge = graph["edges"][0]
        assert first_edge["data"]["sourceType"] == "start"
        assert first_edge["data"]["targetType"] == "llm"

        # Viewport must be float-coerced.
        assert isinstance(graph["viewport"]["zoom"], float)

    def test_missing_end_node_returns_error(self, planner_response):
        planner_payload = json.loads(planner_response)
        planner_payload["nodes"] = planner_payload["nodes"][:-1]
        planner_response = json.dumps(planner_payload)
        builder_response = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "llm", "title": "Summarize"},
                    },
                ],
                "edges": [{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner_response, builder_response)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert "end" in result["error"].lower()


class TestWorkflowGeneratorAdvancedChatMode:
    """Generation in ``advanced-chat`` mode terminates with an ``answer`` node."""

    def test_happy_path_terminates_with_answer(self):
        planner = json.dumps(
            {
                "title": "Greeting Bot",
                "description": "Echo greeting.",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "Receive query."},
                    {"label": "Reply", "node_type": "answer", "purpose": "Reply to user."},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "answer", "title": "Reply", "answer": "Hi!"},
                    },
                ],
                "edges": [{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="advanced-chat",
            instruction="Greet me",
        )

        assert result["error"] == ""
        types = [n["data"]["type"] for n in result["graph"]["nodes"]]
        assert types == ["start", "answer"]

    def test_advanced_chat_missing_answer_returns_error(self):
        # Plan + build both end with an `end` node — invalid in advanced-chat mode.
        planner = json.dumps(
            {
                "title": "Bad bot",
                "description": "wrong terminal",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="advanced-chat",
            instruction="x",
        )

        assert "answer" in result["error"].lower()


class TestAutoModeResolution:
    """``mode="auto"`` resolves from the planner output — no extra LLM call."""

    _WORKFLOW_PLANNER: dict[str, Any] = {
        "title": "URL Summarizer",
        "description": "Summarize a URL.",
        "nodes": [
            {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Receive URL."},
            {"id": "node2", "label": "End", "node_type": "end", "purpose": "Return summary."},
        ],
        "edges": [{"source": "node1", "target": "node2"}],
    }
    _WORKFLOW_CONFIGS: dict[str, dict[str, Any]] = {
        "node1": {
            "variables": [
                {
                    "variable": "url",
                    "label": "URL",
                    "type": "text-input",
                    "required": True,
                    "max_length": 256,
                    "options": [],
                }
            ]
        },
        "node2": {"outputs": [{"variable": "summary", "value_selector": ["node1", "url"]}]},
    }

    def _generate(self, planner: dict[str, Any], configs: dict[str, dict[str, Any]], mode: str):
        model = _ParallelBuilderModel(planner, configs)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode=cast(Any, mode),
            instruction="Summarize a URL",
        )
        return result, model

    def test_auto_resolves_from_planner_mode_field(self):
        planner = {**self._WORKFLOW_PLANNER, "mode": "workflow"}

        result, model = self._generate(planner, self._WORKFLOW_CONFIGS, "auto")

        assert result["error"] == ""
        assert result["mode"] == "workflow"
        # exactly one planner call + one builder per node — no classification call
        assert model.planner_calls == 1
        assert model.builder_calls == 2

    def test_auto_without_mode_field_infers_from_terminal_node(self):
        planner = {
            "title": "Greeting Bot",
            "description": "Echo greeting.",
            "nodes": [
                {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Receive query."},
                {"id": "node2", "label": "Reply", "node_type": "answer", "purpose": "Reply to user."},
            ],
            "edges": [{"source": "node1", "target": "node2"}],
        }
        configs: dict[str, dict[str, Any]] = {"node1": {"variables": []}, "node2": {"answer": "Hi!"}}

        result, _ = self._generate(planner, configs, "auto")

        assert result["error"] == ""
        assert result["mode"] == "advanced-chat"

    def test_auto_ignores_invalid_planner_mode_value(self):
        planner = {**self._WORKFLOW_PLANNER, "mode": "chatbot-3000"}

        result, _ = self._generate(planner, self._WORKFLOW_CONFIGS, "auto")

        assert result["error"] == ""
        assert result["mode"] == "workflow"

    def test_explicit_mode_wins_over_contradictory_planner_mode(self):
        planner = {**self._WORKFLOW_PLANNER, "mode": "advanced-chat"}

        result, _ = self._generate(planner, self._WORKFLOW_CONFIGS, "workflow")

        assert result["error"] == ""
        assert result["mode"] == "workflow"

    def test_auto_planner_failure_stamps_conversational_default(self):
        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = _llm_result("not json at all")

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="auto",
            instruction="x",
        )

        assert result["error"]
        assert result["mode"] == "advanced-chat"

    def test_auto_with_no_terminal_node_defaults_to_conversational(self):
        from core.workflow.generator.runner import _resolve_generation_mode

        plan = cast(Any, {"title": "x", "description": "x", "nodes": [{"node_type": "llm"}]})
        assert _resolve_generation_mode("auto", plan) == "advanced-chat"

    def test_auto_prompt_and_plan_event_carry_resolved_mode(self):
        planner = {**self._WORKFLOW_PLANNER, "mode": "workflow"}
        model = _ParallelBuilderModel(planner, self._WORKFLOW_CONFIGS)

        events = list(
            WorkflowGenerator.generate_workflow_graph_stream(
                model_instance=model,
                model_parameters={},
                provider="openai",
                model_name="gpt-4o",
                model_mode="chat",
                mode="auto",
                instruction="Summarize a URL",
            )
        )

        plan_events = [payload for name, payload in events if name == "plan"]
        assert len(plan_events) == 1
        assert plan_events[0]["mode"] == "workflow"
        planner_prompt = str(model.planner_prompt_messages[-1].content)
        assert "auto (choose workflow or advanced-chat)" in planner_prompt


class TestPlannerSchemaValidation:
    """Planner responses missing the topology contract are rejected with a stage error."""

    _NODES = [{"id": "node1", "label": "Start", "node_type": "start", "purpose": "x"}]

    def test_non_list_nodes_value_is_rejected(self):
        with pytest.raises(ValueError, match="missing 'nodes' array"):
            WorkflowGenerator._validate_planner_schema({"nodes": "start,llm,end"})

    def test_node_entry_without_node_type_is_rejected(self):
        with pytest.raises(ValueError, match="malformed node entry"):
            WorkflowGenerator._validate_planner_schema({"nodes": [{"id": "node1", "label": "Start"}]})

    def test_missing_edges_array_is_rejected(self):
        with pytest.raises(ValueError, match="missing non-empty 'edges' array"):
            WorkflowGenerator._validate_planner_schema({"nodes": self._NODES, "edges": []})

    def test_malformed_edge_entry_is_rejected(self):
        with pytest.raises(ValueError, match="malformed edge entry"):
            WorkflowGenerator._validate_planner_schema({"nodes": self._NODES, "edges": ["node1->node2"]})

    def test_edge_with_non_string_endpoint_is_rejected(self):
        with pytest.raises(ValueError, match="edge missing source or target"):
            WorkflowGenerator._validate_planner_schema(
                {"nodes": self._NODES, "edges": [{"source": "node1", "target": 2}]}
            )


class TestAssembleParallelGraph:
    """Direct assembly contracts not exercised by the fixture-driven pipeline tests."""

    def test_loop_children_are_stamped_and_wired_to_loop_start(self):
        plan_nodes = [
            {"id": "node1", "label": "Retry Loop", "node_type": "loop", "purpose": "x"},
            {"id": "node2", "label": "Step", "node_type": "llm", "purpose": "x", "parent": "Retry Loop"},
        ]

        graph = WorkflowGenerator._assemble_parallel_graph(
            plan_nodes=plan_nodes,
            plan_edges=[],
            configs_by_id={"node1": {}, "node2": {}},
            existing_by_id={},
        )

        child = next(node for node in graph["nodes"] if node["id"] == "node2")
        assert child["parentId"] == "node1"
        assert child["data"]["isInLoop"] is True
        assert child["data"]["loop_id"] == "node1"
        loop_start = next(node for node in graph["nodes"] if node["id"] == "node1start")
        assert loop_start["data"]["type"] == "loop-start"
        assert any(edge["source"] == "node1start" and edge["target"] == "node2" for edge in graph["edges"])

    def test_planned_edge_handles_are_copied_to_graph_edges(self):
        plan_nodes = [
            {"id": "node1", "label": "Branch", "node_type": "if-else", "purpose": "x"},
            {"id": "node2", "label": "Then", "node_type": "llm", "purpose": "x"},
        ]

        graph = WorkflowGenerator._assemble_parallel_graph(
            plan_nodes=plan_nodes,
            plan_edges=[{"source": "node1", "target": "node2", "source_handle": "case1", "target_handle": "target"}],
            configs_by_id={"node1": {}, "node2": {}},
            existing_by_id={},
        )

        edge = graph["edges"][0]
        assert edge["sourceHandle"] == "case1"
        assert edge["targetHandle"] == "target"

    def test_kept_child_without_planned_parent_recovers_containment(self):
        # Refine plans rarely re-state ``parent`` on kept children; the
        # deepcopied wrapper's parentId must keep the child wired to the
        # container's synthetic start node.
        plan_nodes = [
            {"id": "node1", "label": "Per Item", "node_type": "iteration", "purpose": "x", "action": "keep"},
            {"id": "node2", "label": "Step", "node_type": "llm", "purpose": "x", "action": "keep"},
        ]
        existing_by_id = {
            "node1": {
                "id": "node1",
                "data": {"type": "iteration", "title": "Per Item", "start_node_id": "node1start"},
            },
            "node2": {
                "id": "node2",
                "parentId": "node1",
                "extent": "parent",
                "position": {"x": 240, "y": 60},
                "data": {"type": "llm", "title": "Step", "isInIteration": True, "iteration_id": "node1"},
            },
        }

        graph = WorkflowGenerator._assemble_parallel_graph(
            plan_nodes=plan_nodes,
            plan_edges=[],
            configs_by_id={},
            existing_by_id=existing_by_id,
            existing_edges=[{"source": "node1start", "target": "node2"}],
        )

        child = next(node for node in graph["nodes"] if node["id"] == "node2")
        assert child["parentId"] == "node1"
        assert any(edge["source"] == "node1start" and edge["target"] == "node2" for edge in graph["edges"])

    def test_kept_node_with_removed_container_sheds_stale_markers(self):
        plan_nodes = [{"id": "node2", "label": "Step", "node_type": "llm", "purpose": "x", "action": "keep"}]
        existing_by_id = {
            "node2": {
                "id": "node2",
                "parentId": "gone",
                "extent": "parent",
                "zIndex": 1002,
                "position": {"x": 240, "y": 60},
                "data": {"type": "llm", "title": "Step", "isInIteration": True, "iteration_id": "gone"},
            }
        }

        graph = WorkflowGenerator._assemble_parallel_graph(
            plan_nodes=plan_nodes,
            plan_edges=[],
            configs_by_id={},
            existing_by_id=existing_by_id,
            existing_edges=[],
        )

        node = graph["nodes"][0]
        for wrapper_key in ("parentId", "extent", "zIndex", "position"):
            assert wrapper_key not in node
        for marker_key in ("isInIteration", "iteration_id"):
            assert marker_key not in node["data"]

    def test_refine_entry_edge_keeps_existing_target_over_plan_order(self):
        # The planner lists container children in arbitrary order; a kept
        # container's entry edge must follow the existing draft, not the list.
        plan_nodes = [
            {"id": "it", "label": "Per Item", "node_type": "iteration", "purpose": "x"},
            {"id": "b", "label": "B", "node_type": "llm", "purpose": "x", "parent": "Per Item"},
            {"id": "a", "label": "A", "node_type": "llm", "purpose": "x", "parent": "Per Item"},
        ]

        graph = WorkflowGenerator._assemble_parallel_graph(
            plan_nodes=plan_nodes,
            plan_edges=[{"source": "a", "target": "b"}],
            configs_by_id={"it": {}, "a": {}, "b": {}},
            existing_by_id={},
            existing_edges=[{"source": "itstart", "target": "a"}],
        )

        entry = next(edge for edge in graph["edges"] if edge["source"] == "itstart")
        assert entry["target"] == "a"


class TestSoleDeclaredVariable:
    """Human-input output inference feeds the variable-reference reconciler."""

    def test_single_human_input_output_is_inferred(self):
        node = {
            "data": {
                "type": "human-input",
                "inputs": [{"output_variable_name": "approval"}, "junk entry"],
            }
        }
        assert WorkflowGenerator._sole_declared_variable(node) == "approval"

    def test_multiple_human_input_outputs_are_ambiguous(self):
        node = {
            "data": {
                "type": "human-input",
                "inputs": [{"output_variable_name": "a"}, {"output_variable_name": "b"}],
            }
        }
        assert WorkflowGenerator._sole_declared_variable(node) is None

    def test_single_parameter_extractor_output_is_inferred(self):
        node = {"data": {"type": "parameter-extractor", "parameters": [{"name": "city"}]}}
        assert WorkflowGenerator._sole_declared_variable(node) == "city"

    def test_list_operator_declares_its_fixed_outputs(self):
        node = {"data": {"type": "list-operator"}}
        assert WorkflowGenerator._declares_variable(node, "first_record") is True
        assert WorkflowGenerator._declares_variable(node, "not_an_output") is False

    def test_existing_llm_context_placeholder_is_left_untouched(self):
        llm_data = {"prompt_template": [{"role": "user", "text": "Answer using {{#context#}}"}]}
        WorkflowGenerator._ensure_llm_context_placeholder(llm_data)
        assert llm_data["prompt_template"] == [{"role": "user", "text": "Answer using {{#context#}}"}]


class TestWorkflowGeneratorFailurePaths:
    """Planner / builder failures must return an error envelope, never raise."""

    def test_missing_result_event_falls_back_to_stamped_empty_envelope(self, monkeypatch):
        # Guards the defensive fallback for a future refactor that forgets to
        # emit the final result event — the envelope must still carry a
        # concrete mode, never the ``auto`` sentinel.
        monkeypatch.setattr(WorkflowGenerator, "_iter_generation_events", MagicMock(return_value=iter([])))

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=MagicMock(),
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="auto",
            instruction="x",
        )

        assert result["graph"]["nodes"] == []
        assert result["mode"] == "advanced-chat"

    def test_planner_returns_invalid_json(self):
        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = _llm_result("not json at all")

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["error"]
        assert result["graph"]["nodes"] == []

    def test_builder_raises_invoke_error(self):
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"id": "node1", "label": "Start", "node_type": "start", "purpose": "x"},
                    {"id": "node2", "label": "End", "node_type": "end", "purpose": "x"},
                ],
                "edges": [{"source": "node1", "target": "node2"}],
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(planner),
            RuntimeError("provider exploded"),
            RuntimeError("provider exploded"),
        ]

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert "provider exploded" in result["error"]

    def test_edge_references_unknown_node(self):
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"id": "node1", "label": "Start", "node_type": "start", "purpose": "x"},
                    {"id": "node2", "label": "End", "node_type": "end", "purpose": "x"},
                ],
                "edges": [{"source": "node1", "target": "ghost"}],
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = _llm_result(planner)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert "ghost" in result["error"]


class TestWorkflowGeneratorTransientRetry:
    """
    A single transient provider blip (connection drop, 503, rate-limit)
    used to kill the whole two-call generation. The runner now retries
    transient invoke errors with bounded backoff, while permanent errors
    (auth, bad-request) still fail fast so the user isn't billed for
    pointless retries against a misconfigured model.
    """

    @staticmethod
    def _planner() -> str:
        return json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )

    @staticmethod
    def _builder() -> str:
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_retries_transient_invoke_error_then_succeeds(self, monkeypatch: pytest.MonkeyPatch):
        # The planner's first invoke raises a transient connection error; the
        # retry succeeds and the pipeline completes normally. Sleep is patched
        # out so the test doesn't actually wait for the backoff.
        import core.workflow.generator.runner as _runner_mod
        from graphon.model_runtime.errors.invoke import InvokeConnectionError

        monkeypatch.setattr(_runner_mod.time, "sleep", lambda _s: None)

        fixture_model = _GraphFixtureModel(self._planner(), self._builder())
        first_call = True

        def invoke_with_one_failure(**kwargs):
            nonlocal first_call
            if first_call:
                first_call = False
                raise InvokeConnectionError("connection reset")
            return fixture_model._invoke(**kwargs)

        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = invoke_with_one_failure

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["error"] == ""
        # Planner (failed once + retried) plus two node builders.
        assert model_instance.invoke_llm.call_count == 4

    def test_gives_up_after_exhausting_transient_retries(self, monkeypatch: pytest.MonkeyPatch):
        # Every attempt hits the transient error — once we exhaust the retry
        # budget the failure surfaces as a normal error envelope rather than
        # hanging or looping forever.
        import core.workflow.generator.runner as _runner_mod
        from graphon.model_runtime.errors.invoke import InvokeServerUnavailableError

        monkeypatch.setattr(_runner_mod.time, "sleep", lambda _s: None)

        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = InvokeServerUnavailableError("503 from upstream")

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["error"]
        # Bounded: planner attempts == the retry budget, nothing more.
        from core.workflow.generator.runner import _INVOKE_MAX_ATTEMPTS

        assert model_instance.invoke_llm.call_count == _INVOKE_MAX_ATTEMPTS

    def test_does_not_retry_permanent_invoke_error(self, monkeypatch: pytest.MonkeyPatch):
        # An auth error is permanent — retrying just burns latency and quota.
        # The runner must fail on the first attempt.
        # If the code wrongly slept here we'd want the test to still be fast;
        # patch sleep defensively so a regression can't hang CI.
        import core.workflow.generator.runner as _runner_mod
        from graphon.model_runtime.errors.invoke import InvokeAuthorizationError

        monkeypatch.setattr(_runner_mod.time, "sleep", lambda _s: None)

        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = InvokeAuthorizationError("bad key")

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["error"]
        assert model_instance.invoke_llm.call_count == 1


class TestWorkflowGeneratorEdgeCases:
    """
    Smaller behaviours that aren't part of the happy path but matter for
    coverage and resilience.
    """

    def test_clamp_for_planner_lowers_high_temperature(self):
        # The planner needs deterministic output — a permissive temperature
        # would let it ramble. The runner pins it back down for the planner
        # call while leaving the builder call alone.
        from core.workflow.generator.runner import _clamp_for_planner

        out = _clamp_for_planner({"temperature": 0.9, "max_tokens": 1024})
        assert out["temperature"] == 0.2
        # Other params must flow through unchanged so the model still gets
        # provider-tuned defaults.
        assert out["max_tokens"] == 1024

    def test_clamp_for_planner_preserves_low_temperature(self):
        # A user who already picked a tight temperature shouldn't have their
        # setting overridden — clamping only kicks in above 0.5.
        from core.workflow.generator.runner import _clamp_for_planner

        out = _clamp_for_planner({"temperature": 0.3})
        assert out["temperature"] == 0.3

    def test_clamp_for_planner_injects_default_when_missing(self):
        # No temperature → planner picks 0.2 so the output stays consistent
        # across calls.
        from core.workflow.generator.runner import _clamp_for_planner

        out = _clamp_for_planner({})
        assert out["temperature"] == 0.2

    def test_clamp_for_planner_caps_max_tokens_when_missing(self):
        # The planner only emits a small node list, so when the caller didn't
        # pin max_tokens we inject a tight default. This bounds latency/cost
        # and stops a model that ignores the JSON instruction from rambling
        # until it hits the provider's (often huge) default ceiling.
        from core.workflow.generator.runner import _PLANNER_DEFAULT_MAX_TOKENS, _clamp_for_planner

        out = _clamp_for_planner({})
        assert out["max_tokens"] == _PLANNER_DEFAULT_MAX_TOKENS

    def test_clamp_for_planner_preserves_caller_max_tokens(self):
        # A caller who explicitly asked for a budget keeps it — we only fill
        # the default in when it's absent, never override an intentional value.
        from core.workflow.generator.runner import _clamp_for_planner

        out = _clamp_for_planner({"max_tokens": 8192})
        assert out["max_tokens"] == 8192

    def test_planner_no_nodes_surfaces_clear_error(self):
        # The planner returned a malformed plan (empty nodes list). The runner
        # must refuse and tell the caller — never proceed to the builder.
        planner = json.dumps({"title": "x", "description": "x", "nodes": []})
        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = _llm_result(planner)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert "no nodes" in result["error"].lower() or "no 'nodes'" in result["error"]
        # Builder must NOT have been called.
        assert model_instance.invoke_llm.call_count == 1

    def test_tool_catalogue_reaches_planner_and_only_the_tool_builder(self):
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "Search", "node_type": "tool", "purpose": "Search with google/search."},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "tool",
                            "title": "Search",
                            "provider_id": "google",
                            "provider_name": "google",
                            "tool_name": "search",
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "y", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
            tool_catalogue_text="- google/search — Search.",
        )

        all_prompts = []
        for call in model_instance.invoke_llm.call_args_list:
            for msg in call.kwargs["prompt_messages"]:
                all_prompts.append(str(msg.content))

        joined = "\n".join(all_prompts)
        assert joined.count("- google/search — Search.") == 2

    def test_postprocess_lays_out_nodes_left_to_right_regardless_of_input(self):
        # The LLM often returns wildly overlapping positions. The postprocess
        # step must override them with a clean horizontal layout so the
        # preview pane is readable.
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "Middle", "node_type": "llm", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "llm", "title": "Middle"},
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        positions = [n["position"]["x"] for n in result["graph"]["nodes"]]
        assert positions == sorted(positions)
        # All on the same Y so the canvas reads as a horizontal chain.
        ys = {n["position"]["y"] for n in result["graph"]["nodes"]}
        assert len(ys) == 1

    def test_postprocess_dedupes_repeated_edges(self):
        # LLMs frequently emit the same edge twice (once per direction or per
        # pass). The postprocess step must collapse them so the canvas
        # doesn't render visual duplicates.
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "b", "source": "node1", "target": "node2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert len(result["graph"]["edges"]) == 1


# Silence the unused-import warning — pytest is used implicitly via fixtures.
_ = pytest


class TestWorkflowGeneratorContainerNodes:
    """
    Iteration / loop container support — postprocess must preserve the
    relative positions of inner nodes (those with parentId) and mark
    sibling edges with ``isInIteration`` / ``isInLoop`` so the canvas
    renders them inside the subgraph.
    """

    def _planner(self) -> str:
        return json.dumps(
            {
                "title": "Per-Item Summarize",
                "description": "Iterate a list of URLs and summarize each one.",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "Take a list of URLs."},
                    {"label": "Per URL", "node_type": "iteration", "purpose": "Loop over each URL."},
                    {"label": "Summarize", "node_type": "llm", "purpose": "Summarize one URL.", "parent": "Per URL"},
                    {"label": "End", "node_type": "end", "purpose": "Return summaries."},
                ],
            }
        )

    def _builder(self) -> str:
        # Mirrors a real iteration draft: container + auto-start child + inner
        # llm + an end node sibling. Inner nodes carry parentId; the inner
        # edge connects iteration-start → llm.
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "iteration",
                            "title": "Per URL",
                            "start_node_id": "node2start",
                            "iterator_selector": ["node1", "urls"],
                            "output_selector": ["node3", "text"],
                        },
                        "width": 808,
                        "height": 204,
                        "zIndex": 1,
                    },
                    {
                        "id": "node2start",
                        "type": "custom-iteration-start",
                        "parentId": "node2",
                        "extent": "parent",
                        "position": {"x": 60, "y": 78},
                        "data": {"type": "iteration-start", "title": "", "isInIteration": True},
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "parentId": "node2",
                        "extent": "parent",
                        "position": {"x": 240, "y": 60},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "isInIteration": True,
                            "iteration_id": "node2",
                        },
                    },
                    {
                        "id": "node4",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "summaries", "value_selector": ["node2", "output"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2start", "target": "node3", "type": "custom"},
                    {"id": "e3", "source": "node2", "target": "node4", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_inner_node_positions_are_preserved(self):
        # Container children carry positions relative to their parent — the
        # auto-layout step must NOT override them, only top-level nodes get
        # the left-to-right re-flow.
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a list of URLs",
        )

        nodes_by_id = {n["id"]: n for n in result["graph"]["nodes"]}
        inner = nodes_by_id["node3"]
        # Position untouched (60, 60 — what the builder emitted, after the
        # iteration-start was (60, 78)).
        assert inner["position"]["x"] == 240
        assert inner["position"]["y"] == 60
        assert inner["zIndex"] == 1002
        assert inner["extent"] == "parent"

    def test_top_level_nodes_still_get_auto_layout(self):
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a list of URLs",
        )

        # 3 top-level nodes: start, iteration container, end — laid out
        # left-to-right.
        top_level = [n for n in result["graph"]["nodes"] if not n.get("parentId")]
        xs = [n["position"]["x"] for n in top_level]
        assert xs == sorted(xs)
        assert len(set(xs)) == 3

    def test_sibling_edges_inside_container_are_flagged(self):
        # The iteration-start → llm edge (both children of node2) must be
        # flagged isInIteration with iteration_id pointing at the container.
        # The edges crossing the container boundary must NOT be flagged.
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a list of URLs",
        )

        edges_by_id = {e["id"]: e for e in result["graph"]["edges"]}
        inner_edge = edges_by_id["node2start-source-node3-target"]
        assert inner_edge["data"]["isInIteration"] is True
        assert inner_edge["data"]["iteration_id"] == "node2"
        assert inner_edge["zIndex"] == 1002

        outside_edge = edges_by_id["node1-source-node2-target"]
        assert outside_edge["data"]["isInIteration"] is False
        assert outside_edge["data"]["isInLoop"] is False


class TestWorkflowGeneratorAppMetadata:
    """
    Planner-supplied ``app_name`` / ``icon`` flow through to the result so
    the frontend's ``applyToNewApp`` can use a meaningful product name and
    emoji instead of the canned ``deriveAppName`` + 🤖 fallback.
    """

    def _planner_with_metadata(self) -> str:
        return json.dumps(
            {
                "title": "URL Summarizer",
                "description": "Fetch a URL and summarize it.",
                "app_name": "URL Summarizer",
                "icon": "📰",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "Take URL."},
                    {"label": "End", "node_type": "end", "purpose": "Return summary."},
                ],
            }
        )

    def _planner_without_metadata(self) -> str:
        return json.dumps(
            {
                "title": "Untitled",
                "description": "...",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )

    def _minimal_builder(self) -> str:
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node1", "target": "node2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_surfaces_planner_app_name_and_icon(self):
        # When the planner emits ``app_name`` + ``icon``, the runner must
        # forward them verbatim. The frontend uses them to name the new App
        # and pick its display icon.
        model_instance = _GraphFixtureModel(self._planner_with_metadata(), self._minimal_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert result["error"] == ""
        assert result["app_name"] == "URL Summarizer"
        assert result["icon"] == "📰"

    def test_defaults_to_empty_strings_when_planner_omits_metadata(self):
        # Planner outputs that drop the optional fields must not break the
        # pipeline — both fields default to "" so the
        # frontend can run its own ``deriveAppName`` + 🤖 fallback.
        model_instance = _GraphFixtureModel(self._planner_without_metadata(), self._minimal_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["error"] == ""
        assert result["app_name"] == ""
        assert result["icon"] == ""

    def test_metadata_is_stripped_of_surrounding_whitespace(self):
        # Some LLMs return ``"app_name": "  URL Summarizer  "`` — the runner
        # must strip both ends so the frontend doesn't have to.
        planner = json.dumps(
            {
                "title": "x",
                "description": "x",
                "app_name": "   URL Summarizer   ",
                "icon": "  📰  ",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        model_instance = _GraphFixtureModel(planner, self._minimal_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert result["app_name"] == "URL Summarizer"
        assert result["icon"] == "📰"


class TestWorkflowGeneratorVariableReferences:
    """
    The builder used to emit ``{{#node1.url#}}`` inside an LLM prompt while
    the start node declared ``"variables": []`` — so the workflow saved
    fine but failed at run time with "variable not found" the moment the
    user clicked Run. Postprocess now walks every reference and auto-fixes
    the dominant failure mode (missing start-node variable).
    """

    def _planner_with_start_inputs(self) -> str:
        return json.dumps(
            {
                "title": "URL Summarizer",
                "description": "Summarize a URL.",
                "start_inputs": [
                    {"variable": "url", "label": "URL", "type": "text-input"},
                ],
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "Take URL."},
                    {"label": "Summarize", "node_type": "llm", "purpose": "Summarize."},
                    {"label": "End", "node_type": "end", "purpose": "Return."},
                ],
            }
        )

    def _planner_without_start_inputs(self) -> str:
        return json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "Summarize", "node_type": "llm", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )

    def _builder_referencing_missing_start_var(self, var: str = "url") -> str:
        # The LLM prompt references {{#node1.<var>#}} but the start node was
        # emitted with an empty variables array — the historical bug.
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "prompt_template": [
                                {"role": "system", "text": "You summarize URLs."},
                                {"role": "user", "text": f"Summarize this: {{{{#node1.{var}#}}}}"},
                            ],
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "summary", "value_selector": ["node2", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_auto_injects_missing_start_variable(self):
        # Even when the planner forgets to declare ``url`` in start_inputs and
        # the builder emits the dangling reference, postprocess must inject a
        # default ``url`` variable on the start node so the run-time resolver
        # can satisfy the LLM prompt.
        model_instance = _GraphFixtureModel(
            self._planner_without_start_inputs(), self._builder_referencing_missing_start_var("url")
        )

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        names = {v["variable"] for v in start["data"]["variables"]}
        assert "url" in names
        injected = next(v for v in start["data"]["variables"] if v["variable"] == "url")
        assert injected["label"] == "Url"
        assert injected["type"] == "paragraph"
        # And the generation still succeeds (no error envelope).
        assert result["error"] == ""

    def test_does_not_re_inject_declared_start_variable(self):
        # When the builder DID declare ``url`` on the start node, the walker
        # must leave it alone — we don't want duplicates or to overwrite the
        # builder-chosen type (text-input → paragraph would regress UX).
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [
                                {
                                    "variable": "url",
                                    "label": "URL",
                                    "type": "text-input",
                                    "required": True,
                                    "max_length": 256,
                                    "options": [],
                                }
                            ],
                        },
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "prompt_template": [
                                {"role": "user", "text": "Summarize {{#node1.url#}}"},
                            ],
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "out", "value_selector": ["node2", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(self._planner_with_start_inputs(), builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        urls = [v for v in start["data"]["variables"] if v["variable"] == "url"]
        # Exactly one ``url`` variable, with the builder-chosen ``text-input`` type.
        assert len(urls) == 1
        assert urls[0]["type"] == "text-input"

    def test_value_selector_references_are_walked(self):
        # value_selector references must also be considered — they're how end
        # nodes / code nodes / etc. read upstream outputs without prompt
        # interpolation. A dangling start-node variable in a selector should
        # be auto-injected, same as in a prompt placeholder.
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "code",
                            "title": "Process",
                            "code_language": "python3",
                            "code": "def main(topic): return {'result': topic}",
                            "variables": [
                                {"variable": "topic", "value_selector": ["node1", "topic"]},
                            ],
                            "outputs": {"result": {"type": "string", "children": None}},
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "out", "value_selector": ["node2", "result"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        planner_payload = json.loads(self._planner_without_start_inputs())
        planner_payload["nodes"][1].update({"label": "Process", "node_type": "code"})
        model_instance = _GraphFixtureModel(json.dumps(planner_payload), builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        names = {v["variable"] for v in start["data"]["variables"]}
        assert "topic" in names

    def test_sys_query_is_resolved_in_advanced_chat_mode(self):
        # In Advanced-Chat mode the answer node typically references
        # ``{{#sys.query#}}`` — that's an automatic system variable, NOT
        # something the start node declares. The walker must not try to
        # auto-inject ``sys`` as a node-id or ``query`` as a start variable.
        planner = json.dumps(
            {
                "title": "Echo",
                "description": "Echo the user query.",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "Reply", "node_type": "answer", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "answer",
                            "title": "Reply",
                            "variables": [],
                            "answer": "You said: {{#sys.query#}}",
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="advanced-chat",
            instruction="Echo my question",
        )

        # No injection happened — the start node stays empty (sys.query is
        # automatic, no need for a declared variable).
        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        assert start["data"]["variables"] == []
        assert result["error"] == ""

    @pytest.mark.parametrize(
        ("mode", "terminal_type", "expected_selector", "expected_start_variables"),
        [
            ("advanced-chat", "answer", ["sys", "query"], []),
            ("workflow", "end", ["node1", "query"], ["query"]),
        ],
    )
    def test_normalizes_malformed_sys_query_selector(
        self,
        mode,
        terminal_type,
        expected_selector,
        expected_start_variables,
    ):
        terminal_data = {"type": terminal_type, "title": "Terminal"}
        if terminal_type == "answer":
            terminal_data["answer"] = "{{#node2.result#}}"
        else:
            terminal_data["outputs"] = [{"variable": "result", "value_selector": ["node2", "result"]}]
        graph = cast(
            GraphDict,
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "code",
                            "title": "Code",
                            "variables": [{"variable": "query", "value_selector": ["sys,query"]}],
                            "outputs": {"result": {"type": "string"}},
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": terminal_data,
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            },
        )

        result = WorkflowGenerator._postprocess_graph(graph=graph, mode=mode)

        start_node = next(node for node in result["nodes"] if node["id"] == "node1")
        code_node = next(node for node in result["nodes"] if node["id"] == "node2")
        assert code_node["data"]["variables"][0]["value_selector"] == expected_selector
        assert [variable["variable"] for variable in start_node["data"]["variables"]] == expected_start_variables
        assert WorkflowGenerator._validate_structure(graph=result, mode=mode) == []

    @pytest.mark.parametrize(
        "consumer_data",
        [
            {
                "type": "llm",
                "prompt_template": [{"role": "user", "text": "Question: {{#sys,query#}}"}],
            },
            {"type": "question-classifier", "query_variable_selector": ["sys.query"]},
            {"type": "knowledge-retrieval", "query_variable_selector": "sys.query"},
            {
                "type": "if-else",
                "cases": [{"conditions": [{"variable_selector": ["sys,query"]}]}],
            },
            {"type": "parameter-extractor", "query": [["sys", "query"]]},
            {"type": "variable-aggregator", "variables": [["sys.query"]]},
            {
                "type": "tool",
                "tool_parameters": {"query": {"type": "variable", "value": ["sys,query"]}},
            },
        ],
    )
    @pytest.mark.parametrize(("mode", "expected_node_id"), [("advanced-chat", "sys"), ("workflow", "node1")])
    def test_normalizes_sys_query_references_across_node_types(self, consumer_data, mode, expected_node_id):
        graph = cast(
            GraphDict,
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [],
                            # These are literals, not selectors, even though
                            # their values happen to resemble one.
                            "options": ["sys", "query"],
                        },
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"title": "Consumer", **deepcopy(consumer_data)},
                    },
                ],
                "edges": [],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            },
        )

        result = WorkflowGenerator._postprocess_graph(graph=graph, mode=mode)

        refs: set[tuple[str, str]] = set()
        consumer = next(node for node in result["nodes"] if node["id"] == "node2")
        WorkflowGenerator._collect_refs_in_data(consumer["data"], refs)
        assert refs == {(expected_node_id, "query")}

        start = next(node for node in result["nodes"] if node["id"] == "node1")
        assert start["data"]["options"] == ["sys", "query"]
        expected_start_variables = [] if mode == "advanced-chat" else ["query"]
        assert [variable["variable"] for variable in start["data"]["variables"]] == expected_start_variables

    def test_repairs_llm_that_uses_only_one_of_two_incoming_retrieval_results(self):
        graph = cast(
            GraphDict,
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [{"variable": "query", "type": "paragraph"}],
                        },
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "knowledge-retrieval",
                            "title": "Knowledge A",
                            "query_variable_selector": ["node1", "query"],
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "knowledge-retrieval",
                            "title": "Knowledge B",
                            "query_variable_selector": ["node1", "query"],
                        },
                    },
                    {
                        "id": "node4",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Synthesize",
                            "context": {"enabled": True, "variable_selector": ["node2", "result"]},
                            "prompt_template": [
                                {
                                    "role": "user",
                                    "text": "Answer using all retrieved knowledge.",
                                }
                            ],
                        },
                    },
                    {
                        "id": "node5",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "answer", "value_selector": ["node4", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "b", "source": "node1", "target": "node3", "type": "custom"},
                    {"id": "c", "source": "node2", "target": "node4", "type": "custom"},
                    {"id": "d", "source": "node3", "target": "node4", "type": "custom"},
                    {"id": "e", "source": "node4", "target": "node5", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            },
        )

        result = WorkflowGenerator._postprocess_graph(graph=graph, mode="workflow")

        llm = next(node for node in result["nodes"] if node["id"] == "node4")
        template = next(node for node in result["nodes"] if node["data"]["type"] == "template-transform")

        template_refs: set[tuple[str, str]] = set()
        WorkflowGenerator._collect_refs_in_data(template["data"], template_refs)
        assert template_refs == {("node2", "result"), ("node3", "result")}
        rendered_context = Template(template["data"]["template"]).render(
            knowledge_1=[{"content": "Alpha result"}],
            knowledge_2=[{"content": "Beta result"}],
        )
        assert "## Knowledge source 1\nAlpha result" in rendered_context
        assert "## Knowledge source 2\nBeta result" in rendered_context
        assert llm["data"]["context"] == {
            "enabled": True,
            "variable_selector": [template["id"], "output"],
        }
        assert llm["data"]["prompt_template"][0]["text"] == ("Answer using all retrieved knowledge.\n\n{{#context#}}")
        assert {edge["source"] for edge in result["edges"] if edge["target"] == template["id"]} == {
            "node2",
            "node3",
        }
        assert {edge["source"] for edge in result["edges"] if edge["target"] == "node4"} == {template["id"]}
        assert WorkflowGenerator._validate_structure(graph=result, mode="workflow") == []

    def test_start_inputs_flow_into_builder_user_prompt(self):
        # The planner's ``start_inputs`` must be visible to the builder so
        # it can populate ``start.data.variables`` proactively. We sniff the
        # builder's user prompt to confirm the section is rendered.
        model_instance = _GraphFixtureModel(
            self._planner_with_start_inputs(), self._builder_referencing_missing_start_var("url")
        )

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        builder_call = next(
            call
            for call in model_instance.invoke_llm.call_args_list
            if "id=node1, type=start" in str(call.kwargs["prompt_messages"][1].content)
        )
        builder_user_prompt = str(builder_call.kwargs["prompt_messages"][1].content)
        # The Start inputs section must list ``url`` with its declared type.
        assert "Start inputs" in builder_user_prompt
        assert "variable='url'" in builder_user_prompt
        assert "type='text-input'" in builder_user_prompt

    def test_walker_matches_double_brace_placeholders_only(self):
        # Dify's run-time placeholder is ``{{#node.var#}}`` (DOUBLE braces) —
        # see graphon.runtime.variable_pool.VARIABLE_PATTERN. Single-brace
        # ``{#…#}`` is NOT a Dify placeholder, so even if the LLM emits one,
        # the walker should not treat it as a reference (the LLM-at-runtime
        # will see the literal single-brace string and ignore it; nothing
        # for us to validate).
        from core.workflow.generator.runner import WorkflowGenerator

        refs: set[tuple[str, str]] = set()
        WorkflowGenerator._collect_refs_in_data(
            {
                "prompt_template": [
                    {"role": "user", "text": "Bad single: {#node1.url#}"},
                    {"role": "user", "text": "Good double: {{#node2.text#}}"},
                ],
            },
            refs,
        )

        # Single-brace entry is not picked up; only the double-brace one is.
        assert ("node2", "text") in refs
        assert ("node1", "url") not in refs


class TestWorkflowGeneratorNodeIdHyphens:
    """
    Dify's run-time placeholder regex
    (``graphon.runtime.variable_pool.VARIABLE_PATTERN``) accepts only
    ``[a-zA-Z0-9_]`` in the node-id slot. The builder LLM frequently
    emits ``node-1`` style hyphenated ids — left unfixed, every
    ``{{#node-1.var#}}`` placeholder silently fails to match at run time
    and the literal string survives into the LLM prompt, producing the
    "I got {{#node-1.text#}} back instead of real text" failure mode.

    Postprocess defensively strips hyphens out of every id + cross-
    reference before the rest of the pipeline touches them.
    """

    def _planner(self) -> str:
        return json.dumps(
            {
                "title": "Translator",
                "description": "Translate text.",
                "start_inputs": [{"variable": "text", "label": "Text", "type": "paragraph"}],
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "Translate", "node_type": "llm", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )

    def _hyphenated_builder(self) -> str:
        # Mimics what the builder LLM actually emits — hyphenated ids
        # everywhere, in node.id, edge.source/target, value_selector, and
        # ``{{#…#}}`` placeholders.
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [
                                {
                                    "variable": "text",
                                    "label": "Text",
                                    "type": "paragraph",
                                    "required": True,
                                    "max_length": 4096,
                                    "options": [],
                                }
                            ],
                        },
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Translate",
                            "prompt_template": [
                                {"role": "user", "text": "Translate {{#node-1.text#}} to en, es, fr, de."},
                            ],
                        },
                    },
                    {
                        "id": "node-3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "result", "value_selector": ["node-2", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "e2", "source": "node-2", "target": "node-3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_strips_hyphens_from_every_node_id(self):
        # After postprocess, no node id and no cross-reference should
        # contain a hyphen — anything that did would fail at run time.
        model_instance = _GraphFixtureModel(self._planner(), self._hyphenated_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Translate text",
        )

        # Node ids re-mapped.
        ids = [n["id"] for n in result["graph"]["nodes"]]
        assert ids == ["node1", "node2", "node3"]
        # Edge endpoints follow the rename.
        edge_endpoints = [(e["source"], e["target"]) for e in result["graph"]["edges"]]
        assert ("node1", "node2") in edge_endpoints
        assert ("node2", "node3") in edge_endpoints

    def test_rewrites_placeholder_string_when_id_is_remapped(self):
        # The whole reason for the remap — placeholders in prompt_template
        # must use the new id, otherwise the LLM at run time receives the
        # unsubstituted literal.
        model_instance = _GraphFixtureModel(self._planner(), self._hyphenated_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Translate text",
        )

        llm_node = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "llm")
        user_text = next(p["text"] for p in llm_node["data"]["prompt_template"] if p["role"] == "user")
        # Old form is gone; new form is in.
        assert "{{#node-1.text#}}" not in user_text
        assert "{{#node1.text#}}" in user_text

    def test_rewrites_value_selector_lists(self):
        model_instance = _GraphFixtureModel(self._planner(), self._hyphenated_builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Translate text",
        )

        end_node = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "end")
        selector = end_node["data"]["outputs"][0]["value_selector"]
        assert selector == ["node2", "text"]

    def test_leaves_already_clean_ids_untouched(self):
        # When the builder did the right thing the first time, the remap
        # should be a no-op — no spurious churn, no surprising rewrites.
        clean_builder = self._hyphenated_builder().replace("node-", "node")
        model_instance = _GraphFixtureModel(self._planner(), clean_builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        # No "node-" anywhere in the final graph.
        graph_blob = json.dumps(result["graph"])
        assert "node-" not in graph_blob

    def test_walker_does_not_match_hyphenated_placeholders(self):
        # The walker regex now mirrors Dify's run-time regex exactly, so a
        # hyphenated placeholder ``{{#node-1.url#}}`` no longer counts as a
        # detected reference. (The hyphen-strip pass runs first, so this
        # case shouldn't arise in practice, but the contract matters.)
        refs: set[tuple[str, str]] = set()
        WorkflowGenerator._collect_refs_in_data({"text": "Hyphenated: {{#node-1.url#}}. Clean: {{#node1.url#}}."}, refs)
        assert refs == {("node1", "url")}


class TestWorkflowGeneratorStructuredErrors:
    """
    The runner emits a ``errors: list[WorkflowGenerateErrorDict]`` sibling of
    ``error: str`` so the frontend can map machine-readable codes to localised
    copy and tie failures to specific nodes. These tests pin the codes the
    validator emits for each unhappy path; the FE i18n map (and any consumer
    decoding the envelope) relies on them being stable.
    """

    @staticmethod
    def _planner(nodes_spec):
        return json.dumps({"title": "x", "description": "x", "nodes": nodes_spec})

    @staticmethod
    def _builder(nodes, edges):
        return json.dumps({"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.7}})

    def test_happy_path_returns_empty_errors_list(self):
        # Even though older callers only read ``error``, the new ``errors``
        # field must be an empty list on success — never missing — so the
        # frontend's ``res.errors?.[0]?.code`` lookup is type-safe.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End"},
                },
            ],
            edges=[{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        assert result["error"] == ""
        assert result["errors"] == []

    def test_validator_rejects_dangling_parent_id(self):
        # The builder emitted an llm node whose ``parentId`` points at a node
        # that doesn't exist. That would silently render a free-floating node
        # in the canvas at run time; we fail at generation time instead.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "LLM", "node_type": "llm", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "llm", "title": "LLM", "parentId": "ghostcontainer"},
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End"},
                },
            ],
            edges=[
                {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
            ],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        codes = [e["code"] for e in result["errors"]]
        assert "UNKNOWN_NODE_REFERENCE" in codes

    def test_validator_rejects_container_without_children(self):
        # An iteration node with no inner children would deadlock at run time
        # (nothing to iterate over the array against). We surface
        # INVALID_CONTAINER so the user retries instead of hitting a runtime
        # error after Apply.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Loop", "node_type": "iteration", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "iteration", "title": "Loop"},
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End"},
                },
            ],
            edges=[
                {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
            ],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        codes = [e["code"] for e in result["errors"]]
        assert "INVALID_CONTAINER" in codes

    def test_validator_rejects_unknown_tool(self):
        # The builder emitted a tool node naming a provider / tool the tenant
        # doesn't have installed. The validator consults the
        # ``installed_tools`` set the service-layer passes in; a hallucinated
        # name fails with UNKNOWN_TOOL.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Search", "node_type": "tool", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "tool",
                        "title": "Search",
                        "provider_id": "google",
                        "provider_type": "builtin",
                        "provider_name": "google",
                        "tool_name": "fake_search",
                        "tool_label": "Fake",
                        "tool_node_version": "2",
                    },
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End"},
                },
            ],
            edges=[
                {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
            ],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
            # Only "real_search" is installed; "fake_search" is the hallucination.
            installed_tools={("google", "real_search")},
        )
        codes = [e["code"] for e in result["errors"]]
        assert "UNKNOWN_TOOL" in codes

    def test_validator_skips_tool_check_when_catalogue_is_none(self):
        # ``installed_tools=None`` is the sentinel the service uses when the
        # catalogue build itself failed (e.g. plugin daemon down). We must
        # NOT reject every tool node in that case — the user shouldn't be
        # blocked from generating just because the catalogue endpoint had
        # a hiccup.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Search", "node_type": "tool", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "tool",
                        "title": "Search",
                        "provider_id": "google",
                        "provider_name": "google",
                        "tool_name": "any_tool",
                    },
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End"},
                },
            ],
            edges=[
                {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
            ],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
            installed_tools=None,
        )
        codes = [e["code"] for e in result["errors"]]
        assert "UNKNOWN_TOOL" not in codes

    def test_validator_emits_missing_terminal_code(self):
        # The historical assertion was substring-based — pin the structured
        # code too so the frontend i18n map has a stable key.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Process", "node_type": "llm", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "llm", "title": "Process"},
                },
            ],
            edges=[{"source": "node1", "target": "node2"}],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        codes = [e["code"] for e in result["errors"]]
        assert "MISSING_TERMINAL" in codes

    def test_repairs_unresolved_reference_when_source_has_one_output(self):
        # The LLM node references a key the CODE node never declares, but the
        # source exposes exactly one output. Postprocessing can therefore
        # repair the selector without guessing or changing the graph shape.
        planner = self._planner(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Code", "node_type": "code", "purpose": "x"},
                {"label": "LLM", "node_type": "llm", "purpose": "x"},
                {"label": "End", "node_type": "end", "purpose": "x"},
            ]
        )
        builder = self._builder(
            nodes=[
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start"},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "code", "title": "Code", "outputs": {"summary": {"type": "string"}}},
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "llm",
                        "title": "LLM",
                        "prompt_template": [
                            {"role": "user", "text": "Look at {{#node2.mystery#}}."},
                        ],
                    },
                },
                {
                    "id": "node4",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "out", "value_selector": ["node2", "mystery"]}],
                    },
                },
            ],
            edges=[
                {"id": "a", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "b", "source": "node2", "target": "node3", "type": "custom"},
                {"id": "c", "source": "node3", "target": "node4", "type": "custom"},
            ],
        )
        model_instance = _GraphFixtureModel(planner, builder)
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        assert result["error"] == ""
        llm_node = next(node for node in result["graph"]["nodes"] if node["id"] == "node3")
        assert llm_node["data"]["prompt_template"][0]["text"] == "Look at {{#node2.summary#}}."
        end_node = next(node for node in result["graph"]["nodes"] if node["id"] == "node4")
        assert end_node["data"]["outputs"][0]["value_selector"] == ["node2", "summary"]

    def test_keeps_unresolved_reference_when_source_outputs_are_ambiguous(self):
        nodes = [
            {
                "id": "node2",
                "data": {
                    "type": "code",
                    "outputs": {
                        "summary": {"type": "string"},
                        "details": {"type": "string"},
                    },
                },
            },
            {
                "id": "node3",
                "data": {
                    "type": "llm",
                    "prompt_template": [{"role": "user", "text": "Look at {{#node2.mystery#}}."}],
                },
            },
        ]

        WorkflowGenerator._reconcile_variable_references(nodes=nodes, mode="workflow")

        errors = WorkflowGenerator._collect_unresolved_refs(nodes=nodes, mode="workflow")
        assert errors == [
            {
                "code": "UNRESOLVED_REFERENCE",
                "detail": "Reference {#node2.mystery#} not declared on node 'node2'",
                "node_id": "node2",
            }
        ]

    def test_planner_json_failure_retries_once_then_recovers(self):
        # First planner response is non-JSON (the LLM wrapped the response in
        # prose) — we retry exactly once with a corrective system message,
        # the model returns valid JSON, and the rest of the pipeline runs as
        # if nothing went wrong. The builder must NOT be called more than
        # once (its parse still succeeded on first try).
        planner_valid = json.dumps(
            {
                "title": "x",
                "description": "x",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [{"id": "x", "source": "node1", "target": "node2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        fixture_model = _GraphFixtureModel(planner_valid, builder)
        first_call = True

        def invoke_with_invalid_json(**kwargs):
            nonlocal first_call
            if first_call:
                first_call = False
                return _llm_result("[]")
            return fixture_model._invoke(**kwargs)

        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = invoke_with_invalid_json
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        assert result["error"] == ""
        assert result["errors"] == []
        # Two planner attempts plus two node builders.
        assert model_instance.invoke_llm.call_count == 4

    def test_planner_json_failure_retries_only_once_then_gives_up(self):
        # Both planner attempts return junk. After the retry exhausts we
        # surface INVALID_JSON in the envelope and do NOT call the builder.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result("[]"),  # non-dict on first try
            _llm_result("[]"),  # non-dict on retry — give up
        ]
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        codes = [e["code"] for e in result["errors"]]
        assert "INVALID_JSON" in codes
        # Exactly TWO calls — no third retry, no builder call.
        assert model_instance.invoke_llm.call_count == 2

    def test_planner_invalid_json_emits_invalid_json_code(self):
        # Stable code on the JSON-parse failure path so the FE can localise.
        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = _llm_result("definitely not json")
        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )
        # ``json_repair`` is generous about repairing strings, so we can't
        # guarantee it always raises — but if it succeeds we still expect a
        # downstream schema failure. Either INVALID_JSON or INVALID_SCHEMA is
        # acceptable; both are FE-mapped to "couldn't understand the model
        # response" copy.
        codes = [e["code"] for e in result["errors"]]
        assert any(c in {"INVALID_JSON", "INVALID_SCHEMA", "MODEL_ERROR"} for c in codes)


class TestWorkflowGeneratorRefine:
    """
    Refine mode (cmd+k `/refine`): when ``current_graph`` is passed, the
    existing draft must be injected into BOTH stage prompts so the LLM amends
    the user's graph rather than inventing a new one. ``current_graph=None``
    (the default) keeps the create-from-scratch behaviour untouched.
    """

    def _current_graph(self) -> dict:
        return {
            "nodes": [
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start", "variables": []},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "llm",
                        "title": "Summarize",
                        "prompt_template": [{"role": "user", "text": "Summarize {{#node1.url#}}"}],
                    },
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "end", "title": "End", "outputs": []},
                },
            ],
            "edges": [
                {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }

    def _planner(self) -> str:
        return json.dumps(
            {
                "title": "Summarizer",
                "description": "x",
                "nodes": [
                    {"id": "node1", "label": "Start", "node_type": "start", "purpose": "x", "action": "keep"},
                    {
                        "id": "node2",
                        "label": "Summarize",
                        "node_type": "llm",
                        "purpose": "x",
                        "action": "update",
                    },
                    {"id": "node3", "label": "End", "node_type": "end", "purpose": "x", "action": "keep"},
                ],
                "edges": [
                    {"source": "node1", "target": "node2"},
                    {"source": "node2", "target": "node3"},
                ],
            }
        )

    def _builder(self) -> str:
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "llm", "title": "Summarize"},
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_existing_graph_is_scoped_to_planner_and_updated_node(self):
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Also translate the summary",
            current_graph=self._current_graph(),
        )

        planner_user_prompt = str(model_instance.invoke_llm.call_args_list[0].kwargs["prompt_messages"][1].content)
        builder_call = next(
            call
            for call in model_instance.invoke_llm.call_args_list
            if "id=node2, type=llm" in str(call.kwargs["prompt_messages"][1].content)
        )
        builder_user_prompt = str(builder_call.kwargs["prompt_messages"][1].content)

        # Planner: refine framing + compact summary (node ids/types).
        assert "Existing graph to refine" in planner_user_prompt
        assert "REFINING" in planner_user_prompt
        assert "type='llm'" in planner_user_prompt
        assert "node1 -> node2" in planner_user_prompt

        # The updated node builder sees its own existing semantic config only.
        assert "Existing config to preserve" in builder_user_prompt
        assert "{{#node1.url#}}" in builder_user_prompt

    def test_create_mode_injects_no_existing_graph_section(self):
        # With no current_graph the prompts must be byte-for-byte the create
        # flow — no stray "refine" framing leaks into a from-scratch generation.
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize and translate a URL",
        )

        planner_user_prompt = str(model_instance.invoke_llm.call_args_list[0].kwargs["prompt_messages"][1].content)
        builder_call = next(
            call
            for call in model_instance.invoke_llm.call_args_list
            if "workflow planner" not in str(call.kwargs["prompt_messages"][0].content).lower()
        )
        builder_user_prompt = str(builder_call.kwargs["prompt_messages"][1].content)
        assert "Existing graph to refine" not in planner_user_prompt
        assert "Existing graph to refine" not in builder_user_prompt

    def test_refine_still_returns_a_valid_graph(self):
        # End-to-end: refine runs the same postprocess/validate path and yields
        # a clean graph envelope.
        model_instance = _GraphFixtureModel(self._planner(), self._builder())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Also translate the summary",
            current_graph=self._current_graph(),
        )

        assert result["error"] == ""
        types = [n["data"]["type"] for n in result["graph"]["nodes"]]
        assert types == ["start", "llm", "end"]


class TestWorkflowGeneratorFileVariables:
    """The reported bug: a file-input workflow ("takes in a file, extract its
    content, summarize") generated a start node whose file variable lacked the
    required ``allowed_file_types``, so Studio rejected the draft with
    "supported file types is required". The builder now documents the field and
    the postprocessor backfills it as a final safety net."""

    @staticmethod
    def _planner() -> str:
        return json.dumps(
            {
                "title": "File Summarizer",
                "description": "Summarize an uploaded document into bullet points",
                "app_name": "File Summarizer",
                "icon": "📄",
                "start_inputs": [{"variable": "doc", "label": "Document", "type": "file"}],
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "Take a file"},
                    {"label": "Extract", "node_type": "document-extractor", "purpose": "Extract text"},
                    {"label": "Summarize", "node_type": "llm", "purpose": "Bullet points"},
                    {"label": "End", "node_type": "end", "purpose": "Return"},
                ],
            }
        )

    @staticmethod
    def _builder_file_var_missing_allowed_types() -> str:
        # The builder declares a file variable but (the bug) omits
        # allowed_file_types / upload methods.
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [{"variable": "doc", "label": "Document", "type": "file"}],
                        },
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "document-extractor",
                            "title": "Extract",
                            "variable_selector": ["node1", "doc"],
                            "is_array_file": False,
                        },
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "prompt_template": [{"role": "user", "text": "Summarize {{#node2.text#}}"}],
                        },
                    },
                    {
                        "id": "node4",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "summary", "value_selector": ["node3", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node1", "target": "node2", "type": "custom"},
                    {"id": "e2", "source": "node2", "target": "node3", "type": "custom"},
                    {"id": "e3", "source": "node3", "target": "node4", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_backfills_allowed_file_types_so_draft_loads(self):
        model_instance = _GraphFixtureModel(self._planner(), self._builder_file_var_missing_allowed_types())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="takes in a file, extracting its content, then summarizing into bullet points",
        )

        assert result["error"] == ""
        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        doc = next(v for v in start["data"]["variables"] if v["variable"] == "doc")
        assert doc["type"] == "file"
        # The required field is now present and non-empty — the whole point.
        assert doc["allowed_file_types"]
        assert doc["allowed_file_upload_methods"] == ["local_file", "remote_url"]

    def test_builder_prompt_is_scoped_to_planned_node_types(self):
        model_instance = _GraphFixtureModel(self._planner(), self._builder_file_var_missing_allowed_types())

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize an uploaded file",
        )

        builder_call = next(
            call
            for call in model_instance.invoke_llm.call_args_list
            if "id=node2, type=document-extractor" in str(call.kwargs["prompt_messages"][1].content)
        )
        builder_prompt = str(builder_call.kwargs["prompt_messages"][0].content)
        assert "- document-extractor:" in builder_prompt
        # A node builder receives no schema for any other node type.
        assert "- start:" not in builder_prompt
        assert "- if-else:" not in builder_prompt
        assert "- tool" not in builder_prompt

    def test_promotes_mistyped_var_consumed_by_document_extractor(self):
        # A direct unit test of the backstop: a document-extractor reading a
        # paragraph-typed start var forces it to a file type.
        nodes = [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [{"variable": "doc", "label": "Doc", "type": "paragraph"}],
                },
            },
            {
                "id": "x",
                "data": {
                    "type": "document-extractor",
                    "variable_selector": ["s", "doc"],
                    "is_array_file": False,
                },
            },
        ]
        WorkflowGenerator._normalize_start_file_variables(nodes=nodes)
        doc = nodes[0]["data"]["variables"][0]
        assert doc["type"] == "file"
        assert doc["allowed_file_types"] == ["document"]

    def test_drops_custom_file_type_without_extensions(self):
        nodes = [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [
                        {
                            "variable": "f",
                            "label": "F",
                            "type": "file",
                            "allowed_file_types": ["custom"],
                            "allowed_file_extensions": [],
                        }
                    ],
                },
            }
        ]
        WorkflowGenerator._normalize_start_file_variables(nodes=nodes)
        f = nodes[0]["data"]["variables"][0]
        assert "custom" not in f["allowed_file_types"]
        assert f["allowed_file_types"]  # non-empty fallback

    def test_leaves_valid_file_variable_untouched(self):
        nodes = [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [
                        {
                            "variable": "img",
                            "label": "Img",
                            "type": "file",
                            "allowed_file_types": ["image"],
                            "allowed_file_upload_methods": ["local_file"],
                            "allowed_file_extensions": [],
                        }
                    ],
                },
            }
        ]
        WorkflowGenerator._normalize_start_file_variables(nodes=nodes)
        img = nodes[0]["data"]["variables"][0]
        assert img["allowed_file_types"] == ["image"]
        assert img["allowed_file_upload_methods"] == ["local_file"]

    def test_ignores_non_file_variables(self):
        nodes = [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [{"variable": "t", "label": "T", "type": "text-input"}],
                },
            }
        ]
        WorkflowGenerator._normalize_start_file_variables(nodes=nodes)
        assert "allowed_file_types" not in nodes[0]["data"]["variables"][0]


class TestWorkflowGeneratorIdSanitization:
    """
    Beyond hyphens: the sanitize pass must handle ANY character the run-time
    placeholder regex rejects (dots, spaces, unicode) and must stay
    collision-safe when stripping makes two ids identical — silently merging
    ``node-1`` and ``node1`` would point every reference at one node.
    """

    def test_collision_between_stripped_and_existing_id_gets_a_suffix(self):
        nodes: list[dict[str, Any]] = [
            {"id": "node1", "data": {"type": "start", "variables": []}},
            {
                "id": "node-1",
                "data": {
                    "type": "llm",
                    "prompt_template": [{"role": "user", "text": "{{#node-1.text#}} and {{#node1.x#}}"}],
                },
            },
        ]
        edges = [{"id": "e", "source": "node1", "target": "node-1"}]

        WorkflowGenerator._sanitize_node_ids(nodes=nodes, edges=edges)

        ids = [n["id"] for n in nodes]
        assert len(set(ids)) == 2
        assert ids[0] == "node1"
        renamed = ids[1]
        assert renamed != "node1"
        # Edge target follows the rename; references to the untouched sibling
        # stay untouched.
        assert edges[0]["target"] == renamed
        text = nodes[1]["data"]["prompt_template"][0]["text"]
        assert f"{{{{#{renamed}.text#}}}}" in text
        assert "{{#node1.x#}}" in text

    def test_sanitizes_dots_and_spaces(self):
        nodes: list[dict[str, Any]] = [
            {"id": "step.one", "data": {"type": "start", "variables": []}},
            {
                "id": "step two",
                "data": {"type": "llm", "prompt_template": [{"role": "user", "text": "{{#step two.text#}}"}]},
            },
        ]
        edges = [{"id": "e", "source": "step.one", "target": "step two"}]

        WorkflowGenerator._sanitize_node_ids(nodes=nodes, edges=edges)

        assert [n["id"] for n in nodes] == ["stepone", "steptwo"]
        assert (edges[0]["source"], edges[0]["target"]) == ("stepone", "steptwo")
        assert "{{#steptwo.text#}}" in nodes[1]["data"]["prompt_template"][0]["text"]

    def test_id_with_no_valid_characters_gets_a_fallback(self):
        nodes = [
            {"id": "节点", "data": {"type": "start", "variables": []}},
            {"id": "node2", "data": {"type": "end", "outputs": []}},
        ]
        edges = [{"id": "e", "source": "节点", "target": "node2"}]

        WorkflowGenerator._sanitize_node_ids(nodes=nodes, edges=edges)

        new_id = nodes[0]["id"]
        assert new_id
        assert new_id != "节点"
        assert edges[0]["source"] == new_id


class TestWorkflowGeneratorLayeredLayout:
    """
    Top-level layout is computed from topology (longest-path layering), not
    array order: branches that run in parallel share a column and stack in
    lanes, and a join lands to the right of its deepest input.
    """

    @staticmethod
    def _node(node_id: str, node_type: str) -> dict:
        return {"id": node_id, "type": "custom", "data": {"type": node_type, "title": node_id}}

    def test_diamond_branches_share_a_column_in_separate_lanes(self):
        nodes = [
            self._node("start", "start"),
            self._node("branch", "if-else"),
            self._node("a", "llm"),
            self._node("b", "llm"),
            self._node("join", "variable-aggregator"),
        ]
        edges = [
            {"source": "start", "target": "branch"},
            {"source": "branch", "target": "a"},
            {"source": "branch", "target": "b"},
            {"source": "a", "target": "join"},
            {"source": "b", "target": "join"},
        ]

        WorkflowGenerator._layout_top_level_nodes(nodes=nodes, edges=edges)

        pos = {n["id"]: n["position"] for n in nodes}
        assert pos["start"]["x"] < pos["branch"]["x"] < pos["a"]["x"] < pos["join"]["x"]
        # The two arms share the column but not the lane.
        assert pos["a"]["x"] == pos["b"]["x"]
        assert pos["a"]["y"] != pos["b"]["y"]

    def test_out_of_order_node_array_still_flows_left_to_right(self):
        # Builder emitted the array end-first; topology must win.
        nodes = [
            self._node("end", "end"),
            self._node("middle", "llm"),
            self._node("start", "start"),
        ]
        edges = [
            {"source": "start", "target": "middle"},
            {"source": "middle", "target": "end"},
        ]

        WorkflowGenerator._layout_top_level_nodes(nodes=nodes, edges=edges)

        pos = {n["id"]: n["position"] for n in nodes}
        assert pos["start"]["x"] < pos["middle"]["x"] < pos["end"]["x"]

    def test_join_lands_right_of_its_deepest_branch(self):
        # start → a → b → join, start → join: BFS depth would put join at 1;
        # longest-path layering must put it at 3.
        nodes = [
            self._node("start", "start"),
            self._node("a", "llm"),
            self._node("b", "llm"),
            self._node("join", "end"),
        ]
        edges = [
            {"source": "start", "target": "a"},
            {"source": "a", "target": "b"},
            {"source": "b", "target": "join"},
            {"source": "start", "target": "join"},
        ]

        WorkflowGenerator._layout_top_level_nodes(nodes=nodes, edges=edges)

        pos = {n["id"]: n["position"] for n in nodes}
        assert pos["join"]["x"] > pos["b"]["x"] > pos["a"]["x"] > pos["start"]["x"]

    def test_container_children_are_not_repositioned(self):
        nodes = [
            self._node("start", "start"),
            self._node("iter", "iteration"),
            {
                "id": "inner",
                "type": "custom",
                "parentId": "iter",
                "position": {"x": 60.0, "y": 78.0},
                "data": {"type": "llm", "title": "inner"},
            },
            self._node("end", "end"),
        ]
        edges = [
            {"source": "start", "target": "iter"},
            {"source": "iter", "target": "end"},
        ]

        WorkflowGenerator._layout_top_level_nodes(nodes=nodes, edges=edges)

        inner = next(n for n in nodes if n["id"] == "inner")
        assert inner["position"] == {"x": 60.0, "y": 78.0}

    def test_cycle_members_are_parked_instead_of_hanging(self):
        # A cycle must not hang the layout pass; its members get parked one
        # layer past the laid-out nodes (validation flags the cycle itself).
        nodes = [
            self._node("start", "start"),
            self._node("a", "llm"),
            self._node("b", "llm"),
        ]
        edges = [
            {"source": "start", "target": "a"},
            {"source": "a", "target": "b"},
            {"source": "b", "target": "a"},
        ]

        WorkflowGenerator._layout_top_level_nodes(nodes=nodes, edges=edges)

        for node in nodes:
            assert "position" in node


class TestWorkflowGeneratorBranchHandleRepair:
    """
    Edges leaving if-else / question-classifier on the default "source"
    handle dangle off a handle that doesn't exist on the canvas. The repair
    pass re-homes them onto unused branch handles when (and only when) the
    assignment is unambiguous.
    """

    @staticmethod
    def _if_else_node() -> dict:
        return {
            "id": "branch",
            "data": {
                "type": "if-else",
                "cases": [{"case_id": "true", "conditions": []}],
            },
        }

    def test_assigns_true_then_false_to_default_handle_edges(self):
        nodes = [self._if_else_node()]
        edges = [
            {"source": "branch", "target": "a", "sourceHandle": "source"},
            {"source": "branch", "target": "b"},
        ]

        WorkflowGenerator._repair_branch_edge_handles(nodes=nodes, edges=edges)

        assert edges[0]["sourceHandle"] == "true"
        assert edges[1]["sourceHandle"] == "false"

    def test_respects_an_already_correct_handle(self):
        nodes = [self._if_else_node()]
        edges = [
            {"source": "branch", "target": "a", "sourceHandle": "true"},
            {"source": "branch", "target": "b", "sourceHandle": "source"},
        ]

        WorkflowGenerator._repair_branch_edge_handles(nodes=nodes, edges=edges)

        assert edges[0]["sourceHandle"] == "true"
        assert edges[1]["sourceHandle"] == "false"

    def test_leaves_ambiguous_assignments_alone(self):
        # Three default edges, only two free handles — guessing could swap
        # the IF and ELSE arms, so the repair must not touch anything.
        nodes = [self._if_else_node()]
        edges = [
            {"source": "branch", "target": "a", "sourceHandle": "source"},
            {"source": "branch", "target": "b", "sourceHandle": "source"},
            {"source": "branch", "target": "c", "sourceHandle": "source"},
        ]

        WorkflowGenerator._repair_branch_edge_handles(nodes=nodes, edges=edges)

        assert all(e["sourceHandle"] == "source" for e in edges)

    def test_question_classifier_uses_class_ids(self):
        nodes = [
            {
                "id": "qc",
                "data": {
                    "type": "question-classifier",
                    "classes": [{"id": "1", "name": "A"}, {"id": "2", "name": "B"}],
                },
            }
        ]
        edges = [
            {"source": "qc", "target": "a"},
            {"source": "qc", "target": "b"},
        ]

        WorkflowGenerator._repair_branch_edge_handles(nodes=nodes, edges=edges)

        assert edges[0]["sourceHandle"] == "1"
        assert edges[1]["sourceHandle"] == "2"

    def test_non_branch_nodes_are_untouched(self):
        nodes = [{"id": "llm1", "data": {"type": "llm"}}]
        edges = [{"source": "llm1", "target": "end", "sourceHandle": "source"}]

        WorkflowGenerator._repair_branch_edge_handles(nodes=nodes, edges=edges)

        assert edges[0]["sourceHandle"] == "source"


class TestWorkflowGeneratorGraphCycleValidation:
    """A workflow graph must be a DAG; cycles hang or error the run."""

    def test_self_loop_is_flagged_with_the_node_id(self):
        graph = {
            "nodes": [],
            "edges": [{"source": "a", "target": "a"}],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }
        errors = WorkflowGenerator._collect_edge_cycle_errors(graph=cast(GraphDict, graph), known_ids={"a"})
        assert len(errors) == 1
        assert errors[0]["code"] == "GRAPH_CYCLE"
        assert errors[0]["node_id"] == "a"

    def test_two_node_cycle_is_flagged_once(self):
        graph = {
            "nodes": [],
            "edges": [
                {"source": "start", "target": "a"},
                {"source": "a", "target": "b"},
                {"source": "b", "target": "a"},
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }
        errors = WorkflowGenerator._collect_edge_cycle_errors(
            graph=cast(GraphDict, graph), known_ids={"start", "a", "b"}
        )
        assert len(errors) == 1
        assert errors[0]["code"] == "GRAPH_CYCLE"
        assert "a" in errors[0]["detail"]
        assert "b" in errors[0]["detail"]

    def test_acyclic_graph_produces_no_errors(self):
        graph = {
            "nodes": [],
            "edges": [
                {"source": "start", "target": "a"},
                {"source": "start", "target": "b"},
                {"source": "a", "target": "end"},
                {"source": "b", "target": "end"},
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }
        errors = WorkflowGenerator._collect_edge_cycle_errors(
            graph=cast(GraphDict, graph), known_ids={"start", "a", "b", "end"}
        )
        assert errors == []

    def test_cyclic_builder_output_surfaces_graph_cycle_code(self):
        planner = json.dumps(
            {
                "title": "t",
                "description": "d",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "LLM", "node_type": "llm", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "llm", "title": "LLM"},
                    },
                    {
                        "id": "node3",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End", "outputs": []},
                    },
                ],
                "edges": [
                    {"source": "node1", "target": "node2"},
                    {"source": "node2", "target": "node2"},
                    {"source": "node2", "target": "node3"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        assert any(e["code"] == "GRAPH_CYCLE" for e in result["errors"])


class TestWorkflowGeneratorDuplicateNodeIds:
    """Duplicate planner ids make every cross-reference ambiguous."""

    def test_duplicate_ids_surface_dedicated_code(self):
        planner = json.dumps(
            {
                "title": "t",
                "description": "d",
                "nodes": [
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End", "outputs": []},
                    },
                ],
                "edges": [{"source": "node1", "target": "node1"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = _GraphFixtureModel(planner, builder)

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="x",
        )

        codes = {e["code"] for e in result["errors"]}
        assert codes == {"INVALID_SCHEMA"}


def _stream_planner_json() -> str:
    return json.dumps(
        {
            "title": "URL Summarizer",
            "description": "Fetch a URL, summarize it, return the summary.",
            "app_name": "Summarizer",
            "icon": "🔗",
            "nodes": [
                {"label": "Start", "node_type": "start", "purpose": "User submits URL."},
                {"label": "Summarize", "node_type": "llm", "purpose": "Summarize the page."},
                {"label": "End", "node_type": "end", "purpose": "Return summary."},
            ],
        }
    )


def _stream_builder_json() -> str:
    return json.dumps(
        {
            "nodes": [
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "start", "title": "Start", "desc": "", "variables": []},
                },
                {
                    "id": "node2",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "llm",
                        "title": "Summarize",
                        "desc": "",
                        "prompt_template": [{"role": "user", "text": "{{#node1.url#}}"}],
                    },
                },
                {
                    "id": "node3",
                    "type": "custom",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "type": "end",
                        "title": "End",
                        "desc": "",
                        "outputs": [{"variable": "summary", "value_selector": ["node2", "text"]}],
                    },
                },
            ],
            "edges": [
                {"id": "x", "source": "node1", "target": "node2", "type": "custom"},
                {"id": "y", "source": "node2", "target": "node3", "type": "custom"},
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }
    )


class TestWorkflowGeneratorStream:
    """``generate_workflow_graph_stream`` yields a ``plan`` event then a ``result`` event."""

    def test_stream_emits_plan_then_result(self):
        model_instance = _GraphFixtureModel(_stream_planner_json(), _stream_builder_json())

        events = list(
            WorkflowGenerator.generate_workflow_graph_stream(
                model_instance=model_instance,
                model_parameters={},
                provider="openai",
                model_name="gpt-4o",
                model_mode="chat",
                mode="workflow",
                instruction="Summarize a URL",
            )
        )

        assert [name for name, _ in events] == ["plan", "result"]

        plan = events[0][1]
        assert plan["title"] == "URL Summarizer"
        assert plan["app_name"] == "Summarizer"
        assert plan["mode"] == "workflow"
        assert [n["node_type"] for n in plan["nodes"]] == ["start", "llm", "end"]
        assert plan["nodes"][0]["label"] == "Start"
        assert plan["nodes"][0]["purpose"] == "User submits URL."

        result = events[1][1]
        assert result["error"] == ""
        assert result["mode"] == "workflow"
        assert [n["data"]["type"] for n in result["graph"]["nodes"]] == ["start", "llm", "end"]

    def test_stream_planner_failure_emits_only_result(self):
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = RuntimeError("planner exploded")

        events = list(
            WorkflowGenerator.generate_workflow_graph_stream(
                model_instance=model_instance,
                model_parameters={},
                provider="openai",
                model_name="gpt-4o",
                model_mode="chat",
                mode="workflow",
                instruction="x",
            )
        )

        assert [name for name, _ in events] == ["result"]
        result = events[0][1]
        assert "planner exploded" in result["error"]
        assert result["graph"]["nodes"] == []
        assert result["mode"] == "workflow"

    def test_stream_and_blocking_results_match(self):
        """The streaming ``result`` event must equal the blocking return value."""
        stream_instance = _GraphFixtureModel(_stream_planner_json(), _stream_builder_json())
        blocking_instance = _GraphFixtureModel(_stream_planner_json(), _stream_builder_json())

        kwargs = {
            "model_parameters": {},
            "provider": "openai",
            "model_name": "gpt-4o",
            "model_mode": "chat",
            "mode": "advanced-chat",
            "instruction": "Greet me",
        }
        stream_events = list(WorkflowGenerator.generate_workflow_graph_stream(model_instance=stream_instance, **kwargs))
        stream_result = next(payload for name, payload in stream_events if name == "result")
        blocking_result = WorkflowGenerator.generate_workflow_graph(model_instance=blocking_instance, **kwargs)

        assert stream_result == blocking_result

    def test_blocking_result_includes_resolved_mode(self):
        """Task 3: the non-streaming envelope carries the resolved ``mode`` too."""
        model_instance = _GraphFixtureModel(_stream_planner_json(), _stream_builder_json())

        result = WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        assert result["mode"] == "workflow"
