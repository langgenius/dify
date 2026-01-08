"""
Virtual Node Executor for running embedded sub-nodes within a parent node.

This module handles the execution of virtual nodes defined in a parent node's
`virtual_nodes` configuration. Virtual nodes are complete node definitions
that execute before the parent node.

Example configuration:
    virtual_nodes:
      - id: ext_1
        type: llm
        data:
          model: {...}
          prompt_template: [...]
"""

import time
from collections.abc import Generator
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from core.workflow.enums import NodeType
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from libs.datetime_utils import naive_utc_now

from .entities import RetryConfig, VirtualNodeConfig

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


class VirtualNodeExecutionError(Exception):
    """Error during virtual node execution"""

    def __init__(self, node_id: str, original_error: Exception):
        self.node_id = node_id
        self.original_error = original_error
        super().__init__(f"Virtual node {node_id} execution failed: {original_error}")


class VirtualNodeExecutor:
    """
    Executes virtual sub-nodes embedded within a parent node.

    Virtual nodes are complete node definitions that execute before the parent node.
    Each virtual node:
    - Has its own global ID: "{parent_id}.{local_id}"
    - Generates standard node events
    - Stores outputs in the variable pool
    - Supports retry via parent node's retry config
    """

    def __init__(
        self,
        *,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        parent_node_id: str,
        parent_retry_config: RetryConfig | None = None,
    ):
        self._graph_init_params = graph_init_params
        self._graph_runtime_state = graph_runtime_state
        self._parent_node_id = parent_node_id
        self._parent_retry_config = parent_retry_config or RetryConfig()

    def execute_virtual_nodes(
        self,
        virtual_nodes: list[VirtualNodeConfig],
    ) -> Generator[GraphNodeEventBase, None, dict[str, Any]]:
        """
        Execute all virtual nodes in order.

        Args:
            virtual_nodes: List of virtual node configurations

        Yields:
            Node events from each virtual node execution

        Returns:
            dict mapping local_id -> outputs dict
        """
        results: dict[str, Any] = {}

        for vnode_config in virtual_nodes:
            global_id = vnode_config.get_global_id(self._parent_node_id)

            # Execute with retry
            outputs = yield from self._execute_with_retry(vnode_config, global_id)
            results[vnode_config.id] = outputs

        return results

    def _execute_with_retry(
        self,
        vnode_config: VirtualNodeConfig,
        global_id: str,
    ) -> Generator[GraphNodeEventBase, None, dict[str, Any]]:
        """
        Execute virtual node with retry support.
        """
        retry_config = self._parent_retry_config
        last_error: Exception | None = None

        for attempt in range(retry_config.max_retries + 1):
            try:
                return (yield from self._execute_single_node(vnode_config, global_id))
            except Exception as e:
                last_error = e

                if attempt < retry_config.max_retries:
                    # Yield retry event
                    yield NodeRunRetryEvent(
                        id=str(uuid4()),
                        node_id=global_id,
                        node_type=self._get_node_type(vnode_config.type),
                        node_title=vnode_config.data.get("title", f"Virtual: {vnode_config.id}"),
                        start_at=naive_utc_now(),
                        error=str(e),
                        retry_index=attempt + 1,
                    )

                    time.sleep(retry_config.retry_interval_seconds)
                    continue

                raise VirtualNodeExecutionError(global_id, e) from e

        raise last_error or VirtualNodeExecutionError(global_id, Exception("Unknown error"))

    def _execute_single_node(
        self,
        vnode_config: VirtualNodeConfig,
        global_id: str,
    ) -> Generator[GraphNodeEventBase, None, dict[str, Any]]:
        """
        Execute a single virtual node by instantiating and running it.
        """
        from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING

        # Build node config
        node_config: dict[str, Any] = {
            "id": global_id,
            "data": {
                **vnode_config.data,
                "title": vnode_config.data.get("title", f"Virtual: {vnode_config.id}"),
            },
        }

        # Get the node class for this type
        node_type = self._get_node_type(vnode_config.type)
        node_mapping = NODE_TYPE_CLASSES_MAPPING.get(node_type)
        if not node_mapping:
            raise ValueError(f"No class mapping found for node type: {node_type}")

        node_version = str(vnode_config.data.get("version", "1"))
        node_cls = node_mapping.get(node_version) or node_mapping.get(LATEST_VERSION)
        if not node_cls:
            raise ValueError(f"No class found for node type: {node_type}")

        # Instantiate the node
        node = node_cls(
            id=global_id,
            config=node_config,
            graph_init_params=self._graph_init_params,
            graph_runtime_state=self._graph_runtime_state,
        )

        # Run and collect events
        outputs: dict[str, Any] = {}

        for event in node.run():
            # Mark event as coming from virtual node
            self._mark_event_as_virtual(event, vnode_config)
            yield event

            if isinstance(event, NodeRunSucceededEvent):
                outputs = event.node_run_result.outputs or {}
            elif isinstance(event, NodeRunFailedEvent):
                raise Exception(event.error or "Virtual node execution failed")

        return outputs

    def _mark_event_as_virtual(
        self,
        event: GraphNodeEventBase,
        vnode_config: VirtualNodeConfig,
    ) -> None:
        """Mark event as coming from a virtual node."""
        if isinstance(event, NodeRunStartedEvent):
            event.is_virtual = True
            event.parent_node_id = self._parent_node_id

    def _get_node_type(self, type_str: str) -> NodeType:
        """Convert type string to NodeType enum."""
        type_mapping = {
            "llm": NodeType.LLM,
            "code": NodeType.CODE,
            "tool": NodeType.TOOL,
            "if-else": NodeType.IF_ELSE,
            "question-classifier": NodeType.QUESTION_CLASSIFIER,
            "parameter-extractor": NodeType.PARAMETER_EXTRACTOR,
            "template-transform": NodeType.TEMPLATE_TRANSFORM,
            "variable-assigner": NodeType.VARIABLE_ASSIGNER,
            "http-request": NodeType.HTTP_REQUEST,
            "knowledge-retrieval": NodeType.KNOWLEDGE_RETRIEVAL,
        }
        return type_mapping.get(type_str, NodeType.LLM)
