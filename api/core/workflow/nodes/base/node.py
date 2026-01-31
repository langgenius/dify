from __future__ import annotations

import importlib
import logging
import operator
import pkgutil
from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from functools import singledispatchmethod
from types import MappingProxyType
from typing import Any, ClassVar, Generic, TypeVar, cast, get_args, get_origin
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import AgentNodeStrategyInit, GraphInitParams
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeState, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunAgentLogEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import (
    AgentLogEvent,
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
    NodeEventBase,
    NodeRunResult,
    PauseRequestedEvent,
    RunRetrieverResourceEvent,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from core.workflow.runtime import GraphRuntimeState
from libs.datetime_utils import naive_utc_now
from models.enums import UserFrom

from .entities import BaseNodeData, RetryConfig

NodeDataT = TypeVar("NodeDataT", bound=BaseNodeData)

logger = logging.getLogger(__name__)


class Node(Generic[NodeDataT]):
    node_type: ClassVar[NodeType]
    execution_type: NodeExecutionType = NodeExecutionType.EXECUTABLE
    _node_data_type: ClassVar[type[BaseNodeData]] = BaseNodeData

    def __init_subclass__(cls, **kwargs: Any) -> None:
        """
        Automatically extract and validate the node data type from the generic parameter.

        When a subclass is defined as `class MyNode(Node[MyNodeData])`, this method:
        1. Inspects `__orig_bases__` to find the `Node[T]` parameterization
        2. Extracts `T` (e.g., `MyNodeData`) from the generic argument
        3. Validates that `T` is a proper `BaseNodeData` subclass
        4. Stores it in `_node_data_type` for automatic hydration in `__init__`

        This eliminates the need for subclasses to manually implement boilerplate
        accessor methods like `_get_title()`, `_get_error_strategy()`, etc.

        How it works:
        ::

            class CodeNode(Node[CodeNodeData]):
                          │         │
                          │         └─────────────────────────────────┐
                          │                                           │
                          ▼                                           ▼
            ┌─────────────────────────────┐     ┌─────────────────────────────────┐
            │  __orig_bases__ = (         │     │  CodeNodeData(BaseNodeData)     │
            │    Node[CodeNodeData],      │     │    title: str                   │
            │  )                          │     │    desc: str | None             │
            └──────────────┬──────────────┘     │    ...                          │
                           │                    └─────────────────────────────────┘
                           ▼                                      ▲
            ┌─────────────────────────────┐                       │
            │  get_origin(base) -> Node   │                       │
            │  get_args(base) -> (        │                       │
            │    CodeNodeData,            │ ──────────────────────┘
            │  )                          │
            └──────────────┬──────────────┘
                           │
                           ▼
            ┌─────────────────────────────┐
            │  Validate:                  │
            │  - Is it a type?            │
            │  - Is it a BaseNodeData     │
            │    subclass?                │
            └──────────────┬──────────────┘
                           │
                           ▼
            ┌─────────────────────────────┐
            │  cls._node_data_type =      │
            │    CodeNodeData             │
            └─────────────────────────────┘

        Later, in __init__:
        ::

            config["data"] ──► _hydrate_node_data() ──► _node_data_type.model_validate()
                                                                │
                                                                ▼
                                                        CodeNodeData instance
                                                        (stored in self._node_data)

        Example:
            class CodeNode(Node[CodeNodeData]):  # CodeNodeData is auto-extracted
                node_type = NodeType.CODE
                # No need to implement _get_title, _get_error_strategy, etc.
        """
        super().__init_subclass__(**kwargs)

        if cls is Node:
            return

        node_data_type = cls._extract_node_data_type_from_generic()

        if node_data_type is None:
            raise TypeError(f"{cls.__name__} must inherit from Node[T] with a BaseNodeData subtype")

        cls._node_data_type = node_data_type

        # Skip base class itself
        if cls is Node:
            return
        # Only register production node implementations defined under core.workflow.nodes.*
        # This prevents test helper subclasses from polluting the global registry and
        # accidentally overriding real node types (e.g., a test Answer node).
        module_name = getattr(cls, "__module__", "")
        # Only register concrete subclasses that define node_type and version()
        node_type = cls.node_type
        version = cls.version()
        bucket = Node._registry.setdefault(node_type, {})
        if module_name.startswith("core.workflow.nodes."):
            # Production node definitions take precedence and may override
            bucket[version] = cls  # type: ignore[index]
        else:
            # External/test subclasses may register but must not override production
            bucket.setdefault(version, cls)  # type: ignore[index]
        # Maintain a "latest" pointer preferring numeric versions; fallback to lexicographic
        version_keys = [v for v in bucket if v != "latest"]
        numeric_pairs: list[tuple[str, int]] = []
        for v in version_keys:
            numeric_pairs.append((v, int(v)))
        if numeric_pairs:
            latest_key = max(numeric_pairs, key=operator.itemgetter(1))[0]
        else:
            latest_key = max(version_keys) if version_keys else version
        bucket["latest"] = bucket[latest_key]

    @classmethod
    def _extract_node_data_type_from_generic(cls) -> type[BaseNodeData] | None:
        """
        Extract the node data type from the generic parameter `Node[T]`.

        Inspects `__orig_bases__` to find the `Node[T]` parameterization and extracts `T`.

        Returns:
            The extracted BaseNodeData subtype, or None if not found.

        Raises:
            TypeError: If the generic argument is invalid (not exactly one argument,
                      or not a BaseNodeData subtype).
        """
        # __orig_bases__ contains the original generic bases before type erasure.
        # For `class CodeNode(Node[CodeNodeData])`, this would be `(Node[CodeNodeData],)`.
        for base in getattr(cls, "__orig_bases__", ()):  # type: ignore[attr-defined]
            origin = get_origin(base)  # Returns `Node` for `Node[CodeNodeData]`
            if origin is Node:
                args = get_args(base)  # Returns `(CodeNodeData,)` for `Node[CodeNodeData]`
                if len(args) != 1:
                    raise TypeError(f"{cls.__name__} must specify exactly one node data generic argument")

                candidate = args[0]
                if not isinstance(candidate, type) or not issubclass(candidate, BaseNodeData):
                    raise TypeError(f"{cls.__name__} must parameterize Node with a BaseNodeData subtype")

                return candidate

        return None

    # Global registry populated via __init_subclass__
    _registry: ClassVar[dict[NodeType, dict[str, type[Node]]]] = {}

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
    ) -> None:
        self._graph_init_params = graph_init_params
        self.id = id
        self.tenant_id = graph_init_params.tenant_id
        self.app_id = graph_init_params.app_id
        self.workflow_id = graph_init_params.workflow_id
        self.graph_config = graph_init_params.graph_config
        self.user_id = graph_init_params.user_id
        self.user_from = UserFrom(graph_init_params.user_from)
        self.invoke_from = InvokeFrom(graph_init_params.invoke_from)
        self.workflow_call_depth = graph_init_params.call_depth
        self.graph_runtime_state = graph_runtime_state
        self.state: NodeState = NodeState.UNKNOWN  # node execution state

        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required.")

        self._node_id = node_id
        self._node_execution_id: str = ""
        self._start_at = naive_utc_now()

        raw_node_data = config.get("data") or {}
        if not isinstance(raw_node_data, Mapping):
            raise ValueError("Node config data must be a mapping.")

        self._node_data: NodeDataT = self._hydrate_node_data(raw_node_data)

        self.post_init()

    def post_init(self) -> None:
        """Optional hook for subclasses requiring extra initialization."""
        return

    @property
    def graph_init_params(self) -> GraphInitParams:
        return self._graph_init_params

    @property
    def execution_id(self) -> str:
        return self._node_execution_id

    def ensure_execution_id(self) -> str:
        if not self._node_execution_id:
            self._node_execution_id = str(uuid4())
        return self._node_execution_id

    def _hydrate_node_data(self, data: Mapping[str, Any]) -> NodeDataT:
        return cast(NodeDataT, self._node_data_type.model_validate(data))

    @abstractmethod
    def _run(self) -> NodeRunResult | Generator[NodeEventBase, None, None]:
        """
        Run node
        :return:
        """
        raise NotImplementedError

    def _should_stop(self) -> bool:
        """Check if execution should be stopped."""
        return self.graph_runtime_state.stop_event.is_set()

    def run(self) -> Generator[GraphNodeEventBase, None, None]:
        execution_id = self.ensure_execution_id()
        self._start_at = naive_utc_now()

        # Create and push start event with required fields
        start_event = NodeRunStartedEvent(
            id=execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.title,
            in_iteration_id=None,
            start_at=self._start_at,
        )

        # === FIXME(-LAN-): Needs to refactor.
        from core.workflow.nodes.tool.tool_node import ToolNode

        if isinstance(self, ToolNode):
            start_event.provider_id = getattr(self.node_data, "provider_id", "")
            start_event.provider_type = getattr(self.node_data, "provider_type", "")

        from core.workflow.nodes.datasource.datasource_node import DatasourceNode

        if isinstance(self, DatasourceNode):
            plugin_id = getattr(self.node_data, "plugin_id", "")
            provider_name = getattr(self.node_data, "provider_name", "")

            start_event.provider_id = f"{plugin_id}/{provider_name}"
            start_event.provider_type = getattr(self.node_data, "provider_type", "")

        from core.workflow.nodes.trigger_plugin.trigger_event_node import TriggerEventNode

        if isinstance(self, TriggerEventNode):
            start_event.provider_id = getattr(self.node_data, "provider_id", "")
            start_event.provider_type = getattr(self.node_data, "provider_type", "")

        from typing import cast

        from core.workflow.nodes.agent.agent_node import AgentNode
        from core.workflow.nodes.agent.entities import AgentNodeData

        if isinstance(self, AgentNode):
            start_event.agent_strategy = AgentNodeStrategyInit(
                name=cast(AgentNodeData, self.node_data).agent_strategy_name,
                icon=self.agent_strategy_icon,
            )

        # ===
        yield start_event

        try:
            result = self._run()

            # Handle NodeRunResult
            if isinstance(result, NodeRunResult):
                yield self._convert_node_run_result_to_graph_node_event(result)
                return

            # Handle event stream
            for event in result:
                # NOTE: this is necessary because iteration and loop nodes yield GraphNodeEventBase
                if isinstance(event, NodeEventBase):  # pyright: ignore[reportUnnecessaryIsInstance]
                    yield self._dispatch(event)
                elif isinstance(event, GraphNodeEventBase) and not event.in_iteration_id and not event.in_loop_id:  # pyright: ignore[reportUnnecessaryIsInstance]
                    event.id = self.execution_id
                    yield event
                else:
                    yield event

                if self._should_stop():
                    error_message = "Execution cancelled"
                    yield NodeRunFailedEvent(
                        id=self.execution_id,
                        node_id=self._node_id,
                        node_type=self.node_type,
                        start_at=self._start_at,
                        node_run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.FAILED,
                            error=error_message,
                        ),
                        error=error_message,
                    )
                    return
        except Exception as e:
            logger.exception("Node %s failed to run", self._node_id)
            result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="WorkflowNodeError",
            )
            yield NodeRunFailedEvent(
                id=self.execution_id,
                node_id=self._node_id,
                node_type=self.node_type,
                start_at=self._start_at,
                node_run_result=result,
                error=str(e),
            )

    @classmethod
    def extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        config: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """Extracts references variable selectors from node configuration.

        The `config` parameter represents the configuration for a specific node type and corresponds
        to the `data` field in the node definition object.

        The returned mapping has the following structure:

            {'1747829548239.#1747829667553.result#': ['1747829667553', 'result']}

        For loop and iteration nodes, the mapping may look like this:

            {
                "1748332301644.input_selector": ["1748332363630", "result"],
                "1748332325079.1748332325079.#sys.workflow_id#": ["sys", "workflow_id"],
            }

        where `1748332301644` is the ID of the loop / iteration node,
        and `1748332325079` is the ID of the node inside the loop or iteration node.

        Here, the key consists of two parts: the current node ID (provided as the `node_id`
        parameter to `_extract_variable_selector_to_variable_mapping`) and the variable selector,
        enclosed in `#` symbols. These two parts are separated by a dot (`.`).

        The value is a list of string representing the variable selector, where the first element is the node ID
        of the referenced variable, and the second element is the variable name within that node.

        The meaning of the above response is:

        The node with ID `1747829548239` references the variable `result` from the node with
        ID `1747829667553`. For example, if `1747829548239` is a LLM node, its prompt may contain a
        reference to the `result` output variable of node `1747829667553`.

        :param graph_config: graph config
        :param config: node config
        :return:
        """
        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required when extracting variable selector to variable mapping.")

        # Pass raw dict data instead of creating NodeData instance
        data = cls._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config, node_id=node_id, node_data=config.get("data", {})
        )
        return data

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        return {}

    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        """
        Check if this node blocks the output of specific variables.

        This method is used to determine if a node must complete execution before
        the specified variables can be used in streaming output.

        :param variable_selectors: Set of variable selectors, each as a tuple (e.g., ('conversation', 'str'))
        :return: True if this node blocks output of any of the specified variables, False otherwise
        """
        return False

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {}

    @classmethod
    @abstractmethod
    def version(cls) -> str:
        """`node_version` returns the version of current node type."""
        # NOTE(QuantumGhost): This should be in sync with `NODE_TYPE_CLASSES_MAPPING`.
        #
        # If you have introduced a new node type, please add it to `NODE_TYPE_CLASSES_MAPPING`
        # in `api/core/workflow/nodes/__init__.py`.
        raise NotImplementedError("subclasses of BaseNode must implement `version` method.")

    @classmethod
    def get_node_type_classes_mapping(cls) -> Mapping[NodeType, Mapping[str, type[Node]]]:
        """Return mapping of NodeType -> {version -> Node subclass} using __init_subclass__ registry.

        Import all modules under core.workflow.nodes so subclasses register themselves on import.
        Then we return a readonly view of the registry to avoid accidental mutation.
        """
        # Import all node modules to ensure they are loaded (thus registered)
        import core.workflow.nodes as _nodes_pkg

        for _, _modname, _ in pkgutil.walk_packages(_nodes_pkg.__path__, _nodes_pkg.__name__ + "."):
            # Avoid importing modules that depend on the registry to prevent circular imports.
            if _modname == "core.workflow.nodes.node_mapping":
                continue
            importlib.import_module(_modname)

        # Return a readonly view so callers can't mutate the registry by accident
        return {nt: MappingProxyType(ver_map) for nt, ver_map in cls._registry.items()}

    @property
    def retry(self) -> bool:
        return False

    def _get_error_strategy(self) -> ErrorStrategy | None:
        """Get the error strategy for this node."""
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        """Get the retry configuration for this node."""
        return self._node_data.retry_config

    def _get_title(self) -> str:
        """Get the node title."""
        return self._node_data.title

    def _get_description(self) -> str | None:
        """Get the node description."""
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        """Get the default values dictionary for this node."""
        return self._node_data.default_value_dict

    # Public interface properties that delegate to abstract methods
    @property
    def error_strategy(self) -> ErrorStrategy | None:
        """Get the error strategy for this node."""
        return self._get_error_strategy()

    @property
    def retry_config(self) -> RetryConfig:
        """Get the retry configuration for this node."""
        return self._get_retry_config()

    @property
    def title(self) -> str:
        """Get the node title."""
        return self._get_title()

    @property
    def description(self) -> str | None:
        """Get the node description."""
        return self._get_description()

    @property
    def default_value_dict(self) -> dict[str, Any]:
        """Get the default values dictionary for this node."""
        return self._get_default_value_dict()

    @property
    def node_data(self) -> NodeDataT:
        """Typed access to this node's configuration data."""
        return self._node_data

    def _convert_node_run_result_to_graph_node_event(self, result: NodeRunResult) -> GraphNodeEventBase:
        match result.status:
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self.execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=result,
                    error=result.error,
                )
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self.execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=result,
                )
            case _:
                raise Exception(f"result status {result.status} not supported")

    @singledispatchmethod
    def _dispatch(self, event: NodeEventBase) -> GraphNodeEventBase:
        raise NotImplementedError(f"Node {self._node_id} does not support event type {type(event)}")

    @_dispatch.register
    def _(self, event: StreamChunkEvent) -> NodeRunStreamChunkEvent:
        return NodeRunStreamChunkEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            selector=event.selector,
            chunk=event.chunk,
            is_final=event.is_final,
        )

    @_dispatch.register
    def _(self, event: StreamCompletedEvent) -> NodeRunSucceededEvent | NodeRunFailedEvent:
        match event.node_run_result.status:
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self.execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=event.node_run_result,
                )
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self.execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=event.node_run_result,
                    error=event.node_run_result.error,
                )
            case _:
                raise NotImplementedError(
                    f"Node {self._node_id} does not support status {event.node_run_result.status}"
                )

    @_dispatch.register
    def _(self, event: PauseRequestedEvent) -> NodeRunPauseRequestedEvent:
        return NodeRunPauseRequestedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.PAUSED),
            reason=event.reason,
        )

    @_dispatch.register
    def _(self, event: AgentLogEvent) -> NodeRunAgentLogEvent:
        return NodeRunAgentLogEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            message_id=event.message_id,
            label=event.label,
            node_execution_id=event.node_execution_id,
            parent_id=event.parent_id,
            error=event.error,
            status=event.status,
            data=event.data,
            metadata=event.metadata,
        )

    @_dispatch.register
    def _(self, event: LoopStartedEvent) -> NodeRunLoopStartedEvent:
        return NodeRunLoopStartedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            metadata=event.metadata,
            predecessor_node_id=event.predecessor_node_id,
        )

    @_dispatch.register
    def _(self, event: LoopNextEvent) -> NodeRunLoopNextEvent:
        return NodeRunLoopNextEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            index=event.index,
            pre_loop_output=event.pre_loop_output,
        )

    @_dispatch.register
    def _(self, event: LoopSucceededEvent) -> NodeRunLoopSucceededEvent:
        return NodeRunLoopSucceededEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
        )

    @_dispatch.register
    def _(self, event: LoopFailedEvent) -> NodeRunLoopFailedEvent:
        return NodeRunLoopFailedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            error=event.error,
        )

    @_dispatch.register
    def _(self, event: IterationStartedEvent) -> NodeRunIterationStartedEvent:
        return NodeRunIterationStartedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            metadata=event.metadata,
            predecessor_node_id=event.predecessor_node_id,
        )

    @_dispatch.register
    def _(self, event: IterationNextEvent) -> NodeRunIterationNextEvent:
        return NodeRunIterationNextEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            index=event.index,
            pre_iteration_output=event.pre_iteration_output,
        )

    @_dispatch.register
    def _(self, event: IterationSucceededEvent) -> NodeRunIterationSucceededEvent:
        return NodeRunIterationSucceededEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
        )

    @_dispatch.register
    def _(self, event: IterationFailedEvent) -> NodeRunIterationFailedEvent:
        return NodeRunIterationFailedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.node_data.title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            error=event.error,
        )

    @_dispatch.register
    def _(self, event: RunRetrieverResourceEvent) -> NodeRunRetrieverResourceEvent:
        return NodeRunRetrieverResourceEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            retriever_resources=event.retriever_resources,
            context=event.context,
            node_version=self.version(),
        )
