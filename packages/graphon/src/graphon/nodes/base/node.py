from __future__ import annotations

import logging
import operator
from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from functools import singledispatchmethod
from types import MappingProxyType
from typing import Any, ClassVar, assert_never, get_args, get_origin

from graphon.engine_events.agent import NodeRunAgentLogEvent
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.iteration import (
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
)
from graphon.engine_events.loop import (
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
)
from graphon.engine_events.node import (
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunModelPollingProgressEvent,
    NodeRunPauseRequestedEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    NodeRunVariableUpdatedEvent,
)
from graphon.entities.base_node_data import BaseNodeData, RetryConfig
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeState,
    NodeType,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events.agent import AgentLogEvent
from graphon.node_events.base import (
    NodeEventPayload,
    NodeRunResult,
)
from graphon.node_events.iteration import (
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
)
from graphon.node_events.loop import (
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
)
from graphon.node_events.node import (
    HumanInputFormFilledEvent,
    HumanInputFormTimeoutEvent,
    ModelPollingProgressEvent,
    PauseRequestedEvent,
    RunRetrieverResourceEvent,
    StreamChunkEvent,
    StreamCompletedEvent,
    StreamReasoningEvent,
    VariableUpdatedEvent,
)
from graphon.nodes.container_effects import ContainerAwaitRequest, ContainerRunResult
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState

_MISSING_RUN_CONTEXT_VALUE = object()

logger = logging.getLogger(__name__)


class _NodeRegistryMixin[NodeDataT: BaseNodeData]:
    """Node registry and config helpers kept separate from execution flow."""

    @classmethod
    def get_registry_version(cls: type[Node[NodeDataT]]) -> int:
        return cls._registry_version

    @classmethod
    def extract_variable_selector_to_variable_mapping(
        cls: type[Node[NodeDataT]],
        *,
        graph_config: Mapping[str, Any],
        config: NodeConfigDict,
    ) -> Mapping[str, Sequence[str]]:
        """Extracts references variable selectors from node configuration.

        The `config` parameter represents the configuration for a specific node
        type and corresponds to the `data` field in the node definition object.

        The returned mapping has the following structure:

            {'1747829548239.#1747829667553.result#': ['1747829667553', 'result']}

        For loop and iteration nodes, the mapping may look like this:

            {
                "1748332301644.input_selector": ["1748332363630", "result"],
                "1748332325079.1748332325079.#sys.workflow_id#": ["sys", "workflow_id"],
            }

        where `1748332301644` is the ID of the loop / iteration node,
        and `1748332325079` is the ID of the node inside the loop or iteration node.

        Here, the key consists of two parts: the current node ID (provided as the
        `node_id` parameter to `_extract_variable_selector_to_variable_mapping`)
        and the variable selector,
        enclosed in `#` symbols. These two parts are separated by a dot (`.`).

        The value is a list of string representing the variable selector, where the
        first element is the node ID of the referenced variable, and the second
        element is the variable name within that node.

        The meaning of the above response is:

        The node with ID `1747829548239` references the variable `result` from the
        node with ID `1747829667553`. For example, if `1747829548239` is a LLM
        node, its prompt may contain a reference to the `result` output variable
        of node `1747829667553`.

        :param graph_config: graph config
        :param config: node config

        Returns:
            A mapping from node-local reference keys to concrete variable selectors.

        """
        node_id = config["id"]
        node_data = cls.validate_node_data(config["data"])
        return cls._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            node_id=node_id,
            node_data=node_data,
        )

    @classmethod
    def get_default_config(
        cls: type[Node[NodeDataT]],
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        _ = filters
        return {}

    @classmethod
    def get_node_type_classes_mapping(
        cls: type[Node[NodeDataT]],
    ) -> Mapping[NodeType, Mapping[str, type[Node]]]:
        """Return a read-only view of the currently registered node classes.

        This accessor intentionally performs no imports. The embedding layer that
        owns bootstrap (for example `core.workflow.node_factory`) must import the
        extension node classes before calling it so their subclasses register via
        `__init_subclass__`.

        Returns:
            A read-only mapping of node types to versioned node classes.

        """
        return {
            node_type: MappingProxyType(version_map)
            for node_type, version_map in cls._registry.items()
        }

    @classmethod
    def _extract_mapping_from_node_config(
        cls: type[Node[NodeDataT]],
        *,
        graph_config: Mapping[str, Any],
        config: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        try:
            return cls._extract_mapping_from_valid_node_config(
                graph_config=graph_config,
                config=config,
            )
        except NotImplementedError:
            return {}

    @classmethod
    def _extract_mapping_from_valid_node_config(
        cls: type[Node[NodeDataT]],
        *,
        graph_config: Mapping[str, Any],
        config: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        typed_config = NodeConfigDictAdapter.validate_python(config)
        node_cls = cls._get_node_class_for_config(typed_config)
        if node_cls is None:
            return {}
        return node_cls.extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            config=typed_config,
        )

    @classmethod
    def _get_node_class_for_config(
        cls: type[Node[NodeDataT]],
        config: NodeConfigDict,
    ) -> type[Node] | None:
        node_type = config["data"].type
        node_mapping = cls.get_node_type_classes_mapping()
        if node_type not in node_mapping:
            return None
        node_version = str(config["data"].version)
        return node_mapping[node_type][node_version]


class _NodeDataModelMixin[NodeDataT: BaseNodeData]:
    """Typed node-data hydration helpers."""

    @classmethod
    def node_data_from_mapping(
        cls: type[Node[NodeDataT]],
        node_data: Mapping[str, Any],
    ) -> NodeDataT:
        """Build the concrete node-data instance from a Python mapping.

        This convenience wrapper keeps direct node construction ergonomic for
        callers that naturally start from plain dictionaries while preserving the
        stricter `Node.__init__(..., data=NodeDataT, ...)` contract.

        Returns:
            The validated node data instance for the concrete node subclass.

        """
        return cls.validate_node_data(node_data)

    @classmethod
    def validate_node_data(
        cls: type[Node[NodeDataT]],
        node_data: BaseNodeData | Mapping[str, Any],
    ) -> NodeDataT:
        """Validate shared graph node payloads against the subclass-declared
        NodeData model.

        Re-validate from a dumped payload instead of `from_attributes=True` so
        compatibility extras stored on `BaseNodeData` survive the handoff to the
        concrete node data model. Human Input delivery methods are one such extra
        field until graphon owns that schema.

        Returns:
            The validated node data instance for the concrete node subclass.

        """
        if isinstance(node_data, BaseNodeData):
            payload = node_data.model_dump(mode="python")
        else:
            payload = dict(node_data)
        return cls._get_node_data_type().model_validate(payload)

    def init_node_data(
        self: Node[NodeDataT],
        data: BaseNodeData | Mapping[str, Any],
    ) -> None:
        """Hydrate `_node_data` for legacy callers that bypass `__init__`."""
        self._node_data = self.validate_node_data(data)

    def init_node_identity(self: Node[NodeDataT], node_id: str) -> None:
        """Hydrate node identity for legacy callers that bypass `__init__`."""
        self.id = node_id
        self._node_id = node_id

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


class _NodeRuntimeMixin[NodeDataT: BaseNodeData]:
    """Run-context and execution-lifecycle accessors."""

    def post_init(self: Node[NodeDataT]) -> None:
        """Optional hook for subclasses requiring extra initialization."""
        return

    @property
    def init_params(self: Node[NodeDataT]) -> InitParams:
        """Return the immutable inputs bound during node construction."""
        return self._init_params

    @property
    def run_context(self: Node[NodeDataT]) -> Mapping[str, Any]:
        return self._run_context

    def get_run_context_value(
        self: Node[NodeDataT],
        key: str,
        default: Any = None,
    ) -> Any:
        return self._run_context.get(key, default)

    def require_run_context_value(self: Node[NodeDataT], key: str) -> Any:
        value = self.get_run_context_value(key, _MISSING_RUN_CONTEXT_VALUE)
        if value is _MISSING_RUN_CONTEXT_VALUE:
            msg = f"run_context missing required key: {key}"
            raise ValueError(msg)
        return value

    @property
    def execution_id(self: Node[NodeDataT]) -> str:
        if not self._node_execution_id:
            msg = "node execution_id must be bound before use"
            raise RuntimeError(msg)
        return self._node_execution_id

    def bind_execution_id(self: Node[NodeDataT], execution_id: str) -> None:
        self._node_execution_id = execution_id

    def populate_start_event(
        self: Node[NodeDataT],
        event: NodeRunStartedEvent,
    ) -> None:
        """Allow subclasses to enrich the started event without cross-node imports
        in the base class.
        """
        _ = event

    def blocks_variable_output(
        self: Node[NodeDataT],
        variable_selectors: set[tuple[str, ...]],
    ) -> bool:
        """Check if this node blocks the output of specific variables.

        This method is used to determine if a node must complete execution before
        the specified variables can be used in streaming output.

        :param variable_selectors: Set of variable selectors, each as a tuple
        (e.g., ('conversation', 'str'))

        Returns:
            `True` if this node blocks any requested selector, otherwise `False`.

        """
        _ = variable_selectors
        return False


class Node[NodeDataT: BaseNodeData](
    _NodeRegistryMixin[NodeDataT],
    _NodeDataModelMixin[NodeDataT],
    _NodeRuntimeMixin[NodeDataT],
):
    """BaseNode serves as the foundational class for all node implementations.

    Nodes are allowed to maintain transient states
    (e.g., `LLMNode` uses the `_file_output` attribute to track files generated by
    the LLM). However, these states are not persisted when the workflow is
    suspended or resumed. If a node needs its state to be preserved across
    workflow suspension and resumption, it should include the relevant state data
    in its output.
    """

    node_type: ClassVar[NodeType]
    execution_type: NodeExecutionType = NodeExecutionType.EXECUTABLE
    _node_data_type: ClassVar[type[BaseNodeData]] = BaseNodeData

    def __init_subclass__(cls, **kwargs: Any) -> None:
        """Automatically extract and validate the node data type from the generic
        parameter.

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

            config["data"] ──► _node_data_type.model_validate(..., from_attributes=True)
                                               │
                                               ▼
                                       CodeNodeData instance
                                       (stored in self._node_data)

        Example:
            class CodeNode(Node[CodeNodeData]):  # CodeNodeData is auto-extracted
                node_type = BuiltinNodeTypes.CODE
                # No need to implement _get_title, _get_error_strategy, etc.

        Raises:
            TypeError: If the subclass does not parameterize `Node` with a valid
                `BaseNodeData` subtype.

        """
        super().__init_subclass__(**kwargs)

        if cls is Node:
            return

        node_data_type = cls._extract_node_data_type_from_generic()

        if node_data_type is None:
            msg = (
                f"{cls.__name__} must inherit from Node[T] with a BaseNodeData subtype"
            )
            raise TypeError(msg)

        cls._node_data_type = node_data_type

        # Skip base class itself
        if cls is Node:
            return
        # Only treat nodes from the base graphon package as production
        # registrations. Higher-layer packages may still register subclasses,
        # but graphon itself should not know their module identities.
        # This prevents test helper subclasses from polluting the global registry and
        # accidentally overriding real node types (e.g., a test Answer node).
        module_name = cls.__module__
        # Only register concrete subclasses that define node_type and version()
        node_type = cls.node_type
        version = cls.version()
        bucket = Node._registry.setdefault(node_type, {})
        if module_name.startswith("graphon.nodes."):
            # Production node definitions take precedence and may override
            bucket[version] = cls
        else:
            # External/test subclasses may register but must not override production
            bucket.setdefault(version, cls)
        # Maintain a "latest" pointer preferring numeric versions,
        # fallback to lexicographic.
        version_keys = [v for v in bucket if v != "latest"]
        numeric_pairs = [(v, int(v)) for v in version_keys]
        if numeric_pairs:
            latest_key = max(numeric_pairs, key=operator.itemgetter(1))[0]
        else:
            latest_key = max(version_keys) if version_keys else version
        bucket["latest"] = bucket[latest_key]
        Node._registry_version += 1

    @classmethod
    def _extract_node_data_type_from_generic(
        cls: type[Node[NodeDataT]],
    ) -> type[NodeDataT] | None:
        """Extract the node data type from the generic parameter `Node[T]`.

        Inspects `__orig_bases__` to find the `Node[T]` parameterization and
        extracts `T`.

        Returns:
            The extracted BaseNodeData subtype, or None if not found.

        Raises:
            TypeError: If the generic argument is invalid (not exactly one argument,
                      or not a BaseNodeData subtype).

        """
        for base in cls.__orig_bases__:
            origin = get_origin(base)  # Returns `Node` for `Node[CodeNodeData]`
            if origin is Node:
                args = get_args(
                    base,
                )  # Returns `(CodeNodeData,)` for `Node[CodeNodeData]`
                if len(args) != 1:
                    msg = (
                        f"{cls.__name__} must specify exactly one node data "
                        f"generic argument"
                    )
                    raise TypeError(msg)

                candidate = args[0]
                if not isinstance(candidate, type) or not issubclass(
                    candidate,
                    BaseNodeData,
                ):
                    msg = (
                        f"{cls.__name__} must parameterize Node with a "
                        f"BaseNodeData subtype"
                    )
                    raise TypeError(msg)

                return candidate

        return None

    @classmethod
    def _get_node_data_type(cls: type[Node[NodeDataT]]) -> type[NodeDataT]:
        node_data_type = cls._extract_node_data_type_from_generic()
        if node_data_type is None:
            msg = (
                f"{cls.__name__} must inherit from Node[T] with a BaseNodeData subtype"
            )
            raise TypeError(msg)
        return node_data_type

    # Global registry populated via __init_subclass__
    _registry: ClassVar[dict[NodeType, dict[str, type[Node]]]] = {}
    _registry_version: ClassVar[int] = 0
    __orig_bases__: ClassVar[tuple[object, ...]] = ()

    def __init__(
        self,
        node_id: str,
        data: NodeDataT,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
    ) -> None:
        if not node_id:
            msg = "node_id is required"
            raise ValueError(msg)

        self._init_params = init_params
        self._run_context = MappingProxyType(dict(init_params.run_context))
        self.id = node_id
        self.workflow_id = init_params.workflow_id
        self.graph_config = init_params.graph_config
        self.workflow_call_depth = init_params.call_depth
        self.runtime_state = runtime_state
        self.state: NodeState = NodeState.UNKNOWN  # node execution state

        self._node_id = node_id
        self._node_execution_id: str = ""
        self._start_at = datetime.now(UTC).replace(tzinfo=None)

        self._node_data = self.validate_node_data(data)

        self.post_init()

    @abstractmethod
    def _run(
        self,
    ) -> (
        NodeRunResult
        | Generator[
            NodeEventPayload | NodeEvent | ContainerAwaitRequest,
            None,
            None,
        ]
    ):
        """Run the node and return either a result object or an event stream."""
        raise NotImplementedError

    def run(
        self,
    ) -> Generator[
        NodeEvent | ContainerAwaitRequest,
        None,
        None,
    ]:
        execution_id = self.execution_id
        self._start_at = datetime.now(UTC).replace(tzinfo=None)

        # Create and push start event with required fields
        start_event = NodeRunStartedEvent(
            id=execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.title,
            start_at=self._start_at,
        )
        try:
            self.populate_start_event(start_event)
        except Exception:
            logger.warning(
                "Failed to populate start event for node %s",
                self._node_id,
                exc_info=True,
            )
        yield start_event

        try:
            yield from self._run_events()
        except Exception as e:
            logger.exception("Node %s failed to run", self._node_id)
            yield self._build_run_failed_event(e)

    def _run_events(
        self,
    ) -> Generator[
        NodeEvent | ContainerAwaitRequest,
        None,
        None,
    ]:
        result = self._run()
        if isinstance(result, NodeRunResult):
            yield self._convert_node_run_result_to_node_event(result)
            return

        for event in result:
            yield self._normalize_run_event(event)

    def resume_container(
        self,
        *,
        result: ContainerRunResult,
        started_at: datetime,
    ) -> Generator[NodeEvent | ContainerAwaitRequest, None, None]:
        self._start_at = started_at
        try:
            for event in self._resume_container_events(result=result):
                yield self._normalize_run_event(event)
        except Exception as e:
            logger.exception("Node %s failed to resume", self._node_id)
            yield self._build_run_failed_event(e)

    def _resume_container_events(
        self,
        *,
        result: ContainerRunResult,
    ) -> Generator[
        NodeEventPayload | NodeEvent | ContainerAwaitRequest,
        None,
        None,
    ]:
        _ = result
        msg = f"Node {self._node_id} does not support container resume"
        raise TypeError(msg)

    def _normalize_run_event(
        self,
        event: NodeEventPayload | NodeEvent | ContainerAwaitRequest,
    ) -> NodeEvent | ContainerAwaitRequest:
        if isinstance(event, ContainerAwaitRequest):
            return event
        if isinstance(event, NodeEventPayload):
            return self._dispatch(event)
        if not event.container_id:
            event.id = self.execution_id
        return event

    def _build_run_failed_event(self, error: Exception) -> NodeRunFailedEvent:
        result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error=str(error),
            error_type="WorkflowNodeError",
        )
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        return NodeRunFailedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            start_at=self._start_at,
            finished_at=finished_at,
            node_run_result=result,
            error=str(error),
        )

    @classmethod
    def extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        config: NodeConfigDict,
    ) -> Mapping[str, Sequence[str]]:
        """Extracts references variable selectors from node configuration.

        The `config` parameter represents the configuration for a specific node
        type and corresponds to the `data` field in the node definition object.

        The returned mapping has the following structure:

            {'1747829548239.#1747829667553.result#': ['1747829667553', 'result']}

        For loop and iteration nodes, the mapping may look like this:

            {
                "1748332301644.input_selector": ["1748332363630", "result"],
                "1748332325079.1748332325079.#sys.workflow_id#": ["sys", "workflow_id"],
            }

        where `1748332301644` is the ID of the loop / iteration node,
        and `1748332325079` is the ID of the node inside the loop or iteration node.

        Here, the key consists of two parts: the current node ID (provided as the
        `node_id` parameter to `_extract_variable_selector_to_variable_mapping`)
        and the variable selector,
        enclosed in `#` symbols. These two parts are separated by a dot (`.`).

        The value is a list of string representing the variable selector, where the
        first element is the node ID of the referenced variable, and the second
        element is the variable name within that node.

        The meaning of the above response is:

        The node with ID `1747829548239` references the variable `result` from the
        node with ID `1747829667553`. For example, if `1747829548239` is a LLM
        node, its prompt may contain a reference to the `result` output variable
        of node `1747829667553`.

        :param graph_config: graph config
        :param config: node config

        Returns:
            A mapping from node-local reference keys to concrete variable selectors.

        """
        node_id = config["id"]
        node_data = cls.validate_node_data(config["data"])
        return cls._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            node_id=node_id,
            node_data=node_data,
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: NodeDataT,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        _ = node_id
        _ = node_data
        return {}

    @classmethod
    @abstractmethod
    def version(cls) -> str:
        """`node_version` returns the version of current node type."""
        # NOTE(QuantumGhost): Node versions must remain unique per `NodeType` so
        # registry lookups can resolve numeric versions and `latest`.
        msg = "subclasses of BaseNode must implement `version` method."
        raise NotImplementedError(msg)

    def _convert_node_run_result_to_node_event(
        self,
        result: NodeRunResult,
    ) -> NodeEvent:
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        status = result.status
        match status:
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self.execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    finished_at=finished_at,
                    node_run_result=result,
                    error=result.error,
                )
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self.execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    finished_at=finished_at,
                    node_run_result=result,
                )
            case (
                WorkflowNodeExecutionStatus.PENDING
                | WorkflowNodeExecutionStatus.RUNNING
                | WorkflowNodeExecutionStatus.EXCEPTION
                | WorkflowNodeExecutionStatus.STOPPED
                | WorkflowNodeExecutionStatus.PAUSED
                | WorkflowNodeExecutionStatus.RETRY
            ):
                msg = f"result status {status} not supported"
                raise ValueError(msg)
            case _:
                assert_never(status)

    @singledispatchmethod
    def _dispatch(self, event: NodeEventPayload) -> NodeEvent:
        msg = f"Node {self._node_id} does not support event type {type(event)}"
        raise NotImplementedError(msg)

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
    def _(self, event: StreamReasoningEvent) -> NodeRunReasoningChunkEvent:
        return NodeRunReasoningChunkEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            selector=[self._node_id, "reasoning_content"],
            chunk=event.chunk,
            is_final=event.is_final,
        )

    @_dispatch.register
    def _(self, event: ModelPollingProgressEvent) -> NodeRunModelPollingProgressEvent:
        return NodeRunModelPollingProgressEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            attempt=event.attempt,
            last_checked_at=event.last_checked_at,
            next_check_at=event.next_check_at,
        )

    @_dispatch.register
    def _(
        self,
        event: StreamCompletedEvent,
    ) -> NodeRunSucceededEvent | NodeRunFailedEvent:
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        status = event.node_run_result.status
        match status:
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self.execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    finished_at=finished_at,
                    node_run_result=event.node_run_result,
                )
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self.execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    finished_at=finished_at,
                    node_run_result=event.node_run_result,
                    error=event.node_run_result.error,
                )
            case (
                WorkflowNodeExecutionStatus.PENDING
                | WorkflowNodeExecutionStatus.RUNNING
                | WorkflowNodeExecutionStatus.EXCEPTION
                | WorkflowNodeExecutionStatus.STOPPED
                | WorkflowNodeExecutionStatus.PAUSED
                | WorkflowNodeExecutionStatus.RETRY
            ):
                msg = f"Node {self._node_id} does not support status {status}"
                raise NotImplementedError(msg)
            case _:
                assert_never(status)

    @_dispatch.register
    def _(self, event: VariableUpdatedEvent) -> NodeRunVariableUpdatedEvent:
        return NodeRunVariableUpdatedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            variable=event.variable,
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
    def _(self, event: HumanInputFormFilledEvent) -> NodeRunHumanInputFormFilledEvent:
        return NodeRunHumanInputFormFilledEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=event.node_title,
            rendered_content=event.rendered_content,
            action_id=event.action_id,
            action_text=event.action_text,
            submitted_data=event.submitted_data,
        )

    @_dispatch.register
    def _(self, event: HumanInputFormTimeoutEvent) -> NodeRunHumanInputFormTimeoutEvent:
        return NodeRunHumanInputFormTimeoutEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=event.node_title,
            expiration_time=event.expiration_time,
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
