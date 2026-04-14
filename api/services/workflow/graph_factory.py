"""Factory for programmatically building workflow graphs.

Used by AppService to auto-generate single-node workflow graphs when
creating a new Agent app (AppMode.AGENT).
"""

from typing import Any

from core.workflow.nodes.agent_v2.entities import AGENT_V2_NODE_TYPE


class WorkflowGraphFactory:
    """Builds workflow graph dicts for special app creation flows."""

    @staticmethod
    def create_single_agent_graph(
        model_config: dict[str, Any],
        is_chat: bool = True,
    ) -> dict[str, Any]:
        """Create a minimal start -> agent_v2 -> answer/end graph.

        Args:
            model_config: Model configuration dict with provider, name, mode, completion_params.
            is_chat: If True, creates chatflow (with answer node); otherwise workflow (with end node).

        Returns:
            Graph dict with nodes and edges, ready for WorkflowService.sync_draft_workflow().
        """
        agent_node_data: dict[str, Any] = {
            "type": AGENT_V2_NODE_TYPE,
            "title": "Agent",
            "model": model_config,
            "prompt_template": [
                {"role": "system", "text": "You are a helpful assistant."},
                {"role": "user", "text": "{{#sys.query#}}"},
            ],
            "tools": [],
            "max_iterations": 10,
            "agent_strategy": "auto",
            "context": {"enabled": False},
            "vision": {"enabled": False},
        }

        if is_chat:
            agent_node_data["memory"] = {"window": {"enabled": True, "size": 50}}

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
                "data": agent_node_data,
                "position": {"x": 400, "y": 282},
            },
        ]

        if is_chat:
            nodes.append(
                {
                    "id": "answer",
                    "type": "custom",
                    "data": {
                        "type": "answer",
                        "title": "Answer",
                        "answer": "{{#agent.text#}}",
                    },
                    "position": {"x": 720, "y": 282},
                }
            )
            end_node_id = "answer"
        else:
            nodes.append(
                {
                    "id": "end",
                    "type": "custom",
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [
                            {
                                "value_selector": ["agent", "text"],
                                "variable": "result",
                            }
                        ],
                    },
                    "position": {"x": 720, "y": 282},
                }
            )
            end_node_id = "end"

        edges: list[dict[str, str]] = [
            {
                "id": "start-agent",
                "source": "start",
                "target": "agent",
                "sourceHandle": "source",
                "targetHandle": "target",
            },
            {
                "id": f"agent-{end_node_id}",
                "source": "agent",
                "target": end_node_id,
                "sourceHandle": "source",
                "targetHandle": "target",
            },
        ]

        return {"nodes": nodes, "edges": edges}
