"""
Unit tests for ``WorkflowGenerator``.

The runner is pure domain logic — we mock the injected ``model_instance`` and
assert that the postprocessor produces a structurally valid graph for both
Workflow and Advanced-Chat modes, plus that obvious failure paths surface a
readable error envelope.
"""

import json
from unittest.mock import MagicMock

import pytest

from core.workflow.generator.runner import WorkflowGenerator


def _llm_result(text: str) -> MagicMock:
    """Build a stand-in for ``LLMResult`` that the runner only reads as text."""
    result = MagicMock()
    result.message.get_text_content.return_value = text
    return result


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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "desc": "", "variables": []},
                    },
                    {
                        "id": "node-2",
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
                                {"role": "user", "text": "{{#node-1.url#}}"},
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
                            "desc": "",
                            "outputs": [{"variable": "summary", "value_selector": ["node-2", "text"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "x", "source": "node-2", "target": "node-3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_happy_path_returns_valid_graph(self, planner_response, builder_response):
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(planner_response),
            _llm_result(builder_response),
        ]

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
        builder_response = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "llm", "title": "Summarize"},
                    },
                ],
                "edges": [{"id": "x", "source": "node-1", "target": "node-2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(planner_response),
            _llm_result(builder_response),
        ]

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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "answer", "title": "Reply", "answer": "Hi!"},
                    },
                ],
                "edges": [{"id": "x", "source": "node-1", "target": "node-2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [{"id": "x", "source": "node-1", "target": "node-2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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


class TestWorkflowGeneratorFailurePaths:
    """Planner / builder failures must return an error envelope, never raise."""

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
                "nodes": [{"label": "Start", "node_type": "start", "purpose": "x"}],
            }
        )
        model_instance = MagicMock()
        # First call (planner) returns text; second call (builder) raises.
        model_instance.invoke_llm.side_effect = [
            _llm_result(planner),
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
                    {"label": "Start", "node_type": "start", "purpose": "x"},
                    {"label": "End", "node_type": "end", "purpose": "x"},
                ],
            }
        )
        builder = json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "y", "source": "node-1", "target": "ghost", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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

    def test_tool_catalogue_text_propagates_into_both_prompts(self):
        # The catalogue must reach the planner AND the builder so they share
        # the same tool inventory. We capture both invocations and inspect
        # the prompt strings.
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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [{"id": "x", "source": "node-1", "target": "node-2", "type": "custom"}],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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
        # Catalogue must appear in both planner and builder user prompts.
        assert joined.count("- google/search — Search.") >= 2

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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "llm", "title": "Middle"},
                    },
                    {
                        "id": "node-3",
                        "type": "custom",
                        "position": {"x": 999, "y": 999},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "a", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "b", "source": "node-2", "target": "node-3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "a", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "b", "source": "node-1", "target": "node-2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "iteration",
                            "title": "Per URL",
                            "start_node_id": "node-2start",
                            "iterator_selector": ["node-1", "urls"],
                            "output_selector": ["node-3", "text"],
                        },
                        "width": 808,
                        "height": 204,
                        "zIndex": 1,
                    },
                    {
                        "id": "node-2start",
                        "type": "custom-iteration-start",
                        "parentId": "node-2",
                        "extent": "parent",
                        "position": {"x": 60, "y": 78},
                        "data": {"type": "iteration-start", "title": "", "isInIteration": True},
                    },
                    {
                        "id": "node-3",
                        "type": "custom",
                        "parentId": "node-2",
                        "extent": "parent",
                        "position": {"x": 240, "y": 60},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "isInIteration": True,
                            "iteration_id": "node-2",
                        },
                    },
                    {
                        "id": "node-4",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "end",
                            "title": "End",
                            "outputs": [{"variable": "summaries", "value_selector": ["node-2", "output"]}],
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "e2", "source": "node-2start", "target": "node-3", "type": "custom"},
                    {"id": "e3", "source": "node-2", "target": "node-4", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_inner_node_positions_are_preserved(self):
        # Container children carry positions relative to their parent — the
        # auto-layout step must NOT override them, only top-level nodes get
        # the left-to-right re-flow.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner()),
            _llm_result(self._builder()),
        ]

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
        inner = nodes_by_id["node-3"]
        # Position untouched (60, 60 — what the builder emitted, after the
        # iteration-start was (60, 78)).
        assert inner["position"]["x"] == 240
        assert inner["position"]["y"] == 60
        assert inner["zIndex"] == 1002
        assert inner["extent"] == "parent"

    def test_top_level_nodes_still_get_auto_layout(self):
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner()),
            _llm_result(self._builder()),
        ]

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
        # The iteration-start → llm edge (both children of node-2) must be
        # flagged isInIteration with iteration_id pointing at the container.
        # The edges crossing the container boundary must NOT be flagged.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner()),
            _llm_result(self._builder()),
        ]

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
        inner_edge = edges_by_id["node-2start-source-node-3-target"]
        assert inner_edge["data"]["isInIteration"] is True
        assert inner_edge["data"]["iteration_id"] == "node-2"
        assert inner_edge["zIndex"] == 1002

        outside_edge = edges_by_id["node-1-source-node-2-target"]
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
                    {"label": "Summarize", "node_type": "llm", "purpose": "Summarize the page."},
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
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start"},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "end", "title": "End"},
                    },
                ],
                "edges": [
                    {"id": "x", "source": "node-1", "target": "node-2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )

    def test_surfaces_planner_app_name_and_icon(self):
        # When the planner emits ``app_name`` + ``icon``, the runner must
        # forward them verbatim. The frontend uses them to name the new App
        # and pick its display icon.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_with_metadata()),
            _llm_result(self._minimal_builder()),
        ]

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
        # Older planner outputs (or any model that drops the optional fields)
        # must NOT break the pipeline — both fields default to "" so the
        # frontend can run its own ``deriveAppName`` + 🤖 fallback.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_without_metadata()),
            _llm_result(self._minimal_builder()),
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
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(planner),
            _llm_result(self._minimal_builder()),
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

        assert result["app_name"] == "URL Summarizer"
        assert result["icon"] == "📰"


class TestWorkflowGeneratorVariableReferences:
    """
    The builder used to emit ``{#node-1.url#}`` inside an LLM prompt while
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
        # The LLM prompt references {#node-1.<var>#} but the start node was
        # emitted with an empty variables array — the historical bug.
        return json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-1",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {"type": "start", "title": "Start", "variables": []},
                    },
                    {
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "prompt_template": [
                                {"role": "system", "text": "You summarize URLs."},
                                {"role": "user", "text": f"Summarize this: {{#node-1.{var}#}}"},
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
                            "outputs": [{"variable": "summary", "value_selector": ["node-2", "text"]}],
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

    def test_auto_injects_missing_start_variable(self):
        # Even when the planner forgets to declare ``url`` in start_inputs and
        # the builder emits the dangling reference, postprocess must inject a
        # default ``url`` variable on the start node so the run-time resolver
        # can satisfy the LLM prompt.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_without_start_inputs()),
            _llm_result(self._builder_referencing_missing_start_var("url")),
        ]

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
                        "id": "node-1",
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
                        "id": "node-2",
                        "type": "custom",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "type": "llm",
                            "title": "Summarize",
                            "prompt_template": [
                                {"role": "user", "text": "Summarize {#node-1.url#}"},
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
                            "outputs": [{"variable": "out", "value_selector": ["node-2", "text"]}],
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
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_with_start_inputs()),
            _llm_result(builder),
        ]

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
                    {"id": "node-1", "type": "custom", "position": {"x": 0, "y": 0},
                     "data": {"type": "start", "title": "Start", "variables": []}},
                    {"id": "node-2", "type": "custom", "position": {"x": 0, "y": 0},
                     "data": {
                         "type": "code",
                         "title": "Process",
                         "code_language": "python3",
                         "code": "def main(topic): return {'result': topic}",
                         "variables": [
                             {"variable": "topic", "value_selector": ["node-1", "topic"]},
                         ],
                         "outputs": {"result": {"type": "string", "children": None}},
                     }},
                    {"id": "node-3", "type": "custom", "position": {"x": 0, "y": 0},
                     "data": {"type": "end", "title": "End",
                              "outputs": [{"variable": "out", "value_selector": ["node-2", "result"]}]}},
                ],
                "edges": [
                    {"id": "e1", "source": "node-1", "target": "node-2", "type": "custom"},
                    {"id": "e2", "source": "node-2", "target": "node-3", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_without_start_inputs()),
            _llm_result(builder),
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

        start = next(n for n in result["graph"]["nodes"] if n["data"]["type"] == "start")
        names = {v["variable"] for v in start["data"]["variables"]}
        assert "topic" in names

    def test_sys_query_is_resolved_in_advanced_chat_mode(self):
        # In Advanced-Chat mode the answer node typically references
        # ``{#sys.query#}`` — that's an automatic system variable, NOT
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
                    {"id": "node-1", "type": "custom", "position": {"x": 0, "y": 0},
                     "data": {"type": "start", "title": "Start", "variables": []}},
                    {"id": "node-2", "type": "custom", "position": {"x": 0, "y": 0},
                     "data": {"type": "answer", "title": "Reply",
                              "variables": [], "answer": "You said: {#sys.query#}"}},
                ],
                "edges": [
                    {"id": "e1", "source": "node-1", "target": "node-2", "type": "custom"},
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 0.7},
            }
        )
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [_llm_result(planner), _llm_result(builder)]

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

    def test_start_inputs_flow_into_builder_user_prompt(self):
        # The planner's ``start_inputs`` must be visible to the builder so
        # it can populate ``start.data.variables`` proactively. We sniff the
        # builder's user prompt to confirm the section is rendered.
        model_instance = MagicMock()
        model_instance.invoke_llm.side_effect = [
            _llm_result(self._planner_with_start_inputs()),
            _llm_result(self._builder_referencing_missing_start_var("url")),
        ]

        WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters={},
            provider="openai",
            model_name="gpt-4o",
            model_mode="chat",
            mode="workflow",
            instruction="Summarize a URL",
        )

        builder_user_prompt = str(
            model_instance.invoke_llm.call_args_list[1].kwargs["prompt_messages"][1].content
        )
        # The Start inputs section must list ``url`` with its declared type.
        assert "Start inputs" in builder_user_prompt
        assert "variable='url'" in builder_user_prompt
        assert "type='text-input'" in builder_user_prompt
