from enum import StrEnum
from typing import ClassVar, TypeAlias


class NodeState(StrEnum):
    """State of a node or edge during workflow execution."""

    UNKNOWN = "unknown"
    TAKEN = "taken"
    SKIPPED = "skipped"


class SystemVariableKey(StrEnum):
    """
    System Variables.
    """

    QUERY = "query"
    FILES = "files"
    CONVERSATION_ID = "conversation_id"
    USER_ID = "user_id"
    DIALOGUE_COUNT = "dialogue_count"
    APP_ID = "app_id"
    WORKFLOW_ID = "workflow_id"
    WORKFLOW_EXECUTION_ID = "workflow_run_id"
    TIMESTAMP = "timestamp"
    # RAG Pipeline
    DOCUMENT_ID = "document_id"
    ORIGINAL_DOCUMENT_ID = "original_document_id"
    BATCH = "batch"
    DATASET_ID = "dataset_id"
    DATASOURCE_TYPE = "datasource_type"
    DATASOURCE_INFO = "datasource_info"
    INVOKE_FROM = "invoke_from"


NodeType: TypeAlias = str


class BuiltinNodeTypes:
    """Built-in node type string constants.

    `node_type` values are plain strings throughout the graph runtime. This namespace
    only exposes the built-in values shipped by `dify_graph`; downstream packages can
    use additional strings without extending this class.
    """

    START: ClassVar[NodeType] = "start"
    END: ClassVar[NodeType] = "end"
    ANSWER: ClassVar[NodeType] = "answer"
    LLM: ClassVar[NodeType] = "llm"
    KNOWLEDGE_RETRIEVAL: ClassVar[NodeType] = "knowledge-retrieval"
    IF_ELSE: ClassVar[NodeType] = "if-else"
    CODE: ClassVar[NodeType] = "code"
    TEMPLATE_TRANSFORM: ClassVar[NodeType] = "template-transform"
    QUESTION_CLASSIFIER: ClassVar[NodeType] = "question-classifier"
    HTTP_REQUEST: ClassVar[NodeType] = "http-request"
    TOOL: ClassVar[NodeType] = "tool"
    DATASOURCE: ClassVar[NodeType] = "datasource"
    VARIABLE_AGGREGATOR: ClassVar[NodeType] = "variable-aggregator"
    LEGACY_VARIABLE_AGGREGATOR: ClassVar[NodeType] = "variable-assigner"
    LOOP: ClassVar[NodeType] = "loop"
    LOOP_START: ClassVar[NodeType] = "loop-start"
    LOOP_END: ClassVar[NodeType] = "loop-end"
    ITERATION: ClassVar[NodeType] = "iteration"
    ITERATION_START: ClassVar[NodeType] = "iteration-start"
    PARAMETER_EXTRACTOR: ClassVar[NodeType] = "parameter-extractor"
    VARIABLE_ASSIGNER: ClassVar[NodeType] = "assigner"
    DOCUMENT_EXTRACTOR: ClassVar[NodeType] = "document-extractor"
    LIST_OPERATOR: ClassVar[NodeType] = "list-operator"
    AGENT: ClassVar[NodeType] = "agent"
    HUMAN_INPUT: ClassVar[NodeType] = "human-input"


BUILT_IN_NODE_TYPES: tuple[NodeType, ...] = (
    BuiltinNodeTypes.START,
    BuiltinNodeTypes.END,
    BuiltinNodeTypes.ANSWER,
    BuiltinNodeTypes.LLM,
    BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
    BuiltinNodeTypes.IF_ELSE,
    BuiltinNodeTypes.CODE,
    BuiltinNodeTypes.TEMPLATE_TRANSFORM,
    BuiltinNodeTypes.QUESTION_CLASSIFIER,
    BuiltinNodeTypes.HTTP_REQUEST,
    BuiltinNodeTypes.TOOL,
    BuiltinNodeTypes.DATASOURCE,
    BuiltinNodeTypes.VARIABLE_AGGREGATOR,
    BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR,
    BuiltinNodeTypes.LOOP,
    BuiltinNodeTypes.LOOP_START,
    BuiltinNodeTypes.LOOP_END,
    BuiltinNodeTypes.ITERATION,
    BuiltinNodeTypes.ITERATION_START,
    BuiltinNodeTypes.PARAMETER_EXTRACTOR,
    BuiltinNodeTypes.VARIABLE_ASSIGNER,
    BuiltinNodeTypes.DOCUMENT_EXTRACTOR,
    BuiltinNodeTypes.LIST_OPERATOR,
    BuiltinNodeTypes.AGENT,
    BuiltinNodeTypes.HUMAN_INPUT,
)


class NodeExecutionType(StrEnum):
    """Node execution type classification."""

    EXECUTABLE = "executable"  # Regular nodes that execute and produce outputs
    RESPONSE = "response"  # Response nodes that stream outputs (Answer, End)
    BRANCH = "branch"  # Nodes that can choose different branches (if-else, question-classifier)
    CONTAINER = "container"  # Container nodes that manage subgraphs (iteration, loop, graph)
    ROOT = "root"  # Nodes that can serve as execution entry points


class ErrorStrategy(StrEnum):
    FAIL_BRANCH = "fail-branch"
    DEFAULT_VALUE = "default-value"


class FailBranchSourceHandle(StrEnum):
    FAILED = "fail-branch"
    SUCCESS = "success-branch"


class WorkflowType(StrEnum):
    """
    Workflow Type Enum for domain layer
    """

    WORKFLOW = "workflow"
    CHAT = "chat"
    RAG_PIPELINE = "rag-pipeline"


class WorkflowExecutionStatus(StrEnum):
    # State diagram for the workflw status:
    # (@) means start, (*) means end
    #
    #       ┌------------------>------------------------->------------------->--------------┐
    #       |                                                                               |
    #       |                       ┌-----------------------<--------------------┐          |
    #       ^                       |                                            |          |
    #       |                       |                                            ^          |
    #       |                       V                                            |          |
    # ┌-----------┐        ┌-----------------------┐                       ┌-----------┐    V
    # | Scheduled |------->|        Running        |---------------------->|   paused  |    |
    # └-----------┘        └-----------------------┘                       └-----------┘    |
    #       |                |       |       |    |                              |          |
    #       |                |       |       |    |                              |          |
    #       ^                |       |       |    V                              V          |
    #       |                |       |       |    |                         ┌---------┐     |
    #      (@)               |       |       |    └------------------------>| Stopped |<----┘
    #                        |       |       |                              └---------┘
    #                        |       |       |                                   |
    #                        |       |       V                                   V
    #                        |       |  ┌-----------┐                            |
    #                        |       |  | Succeeded |------------->--------------┤
    #                        |       |  └-----------┘                            |
    #                        |       V                                           V
    #                        |  +--------┐                                       |
    #                        |  | Failed |---------------------->----------------┤
    #                        |  └--------┘                                       |
    #                        V                                                   V
    #             ┌---------------------┐                                        |
    #             | Partially Succeeded |---------------------->-----------------┘--------> (*)
    #             └---------------------┘
    #
    # Mermaid diagram:
    #
    #     ---
    #     title: State diagram for Workflow run state
    #     ---
    #     stateDiagram-v2
    #         scheduled: Scheduled
    #         running: Running
    #         succeeded: Succeeded
    #         failed: Failed
    #         partial_succeeded: Partial Succeeded
    #         paused: Paused
    #         stopped: Stopped
    #
    #         [*] --> scheduled:
    #         scheduled --> running: Start Execution
    #         running --> paused: Human input required
    #         paused --> running: human input added
    #         paused --> stopped: User stops execution
    #         running --> succeeded: Execution finishes without any error
    #         running --> failed: Execution finishes with errors
    #         running --> stopped: User stops execution
    #         running --> partial_succeeded: some execution occurred and handled during execution
    #
    #         scheduled --> stopped: User stops execution
    #
    #         succeeded --> [*]
    #         failed --> [*]
    #         partial_succeeded --> [*]
    #         stopped --> [*]

    # `SCHEDULED` means that the workflow is scheduled to run, but has not
    # started running yet. (maybe due to possible worker saturation.)
    #
    # This enum value is currently unused.
    SCHEDULED = "scheduled"

    # `RUNNING` means the workflow is exeuting.
    RUNNING = "running"

    # `SUCCEEDED` means the execution of workflow succeed without any error.
    SUCCEEDED = "succeeded"

    # `FAILED` means the execution of workflow failed without some errors.
    FAILED = "failed"

    # `STOPPED` means the execution of workflow was stopped, either manually
    # by the user, or automatically by the Dify application (E.G. the moderation
    # mechanism.)
    STOPPED = "stopped"

    # `PARTIAL_SUCCEEDED` indicates that some errors occurred during the workflow
    # execution, but they were successfully handled (e.g., by using an error
    # strategy such as "fail branch" or "default value").
    PARTIAL_SUCCEEDED = "partial-succeeded"

    # `PAUSED` indicates that the workflow execution is temporarily paused
    # (e.g., awaiting human input) and is expected to resume later.
    PAUSED = "paused"

    def is_ended(self) -> bool:
        return self in _END_STATE

    @classmethod
    def ended_values(cls) -> list[str]:
        return [status.value for status in _END_STATE]


_END_STATE = frozenset(
    [
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.STOPPED,
    ]
)


class WorkflowNodeExecutionMetadataKey(StrEnum):
    """
    Node Run Metadata Key.

    Values in this enum are persisted as execution metadata and must stay in sync
    with every node that writes `NodeRunResult.metadata`.
    """

    TOTAL_TOKENS = "total_tokens"
    TOTAL_PRICE = "total_price"
    CURRENCY = "currency"
    TOOL_INFO = "tool_info"
    AGENT_LOG = "agent_log"
    ITERATION_ID = "iteration_id"
    ITERATION_INDEX = "iteration_index"
    LOOP_ID = "loop_id"
    LOOP_INDEX = "loop_index"
    PARALLEL_ID = "parallel_id"
    PARALLEL_START_NODE_ID = "parallel_start_node_id"
    PARENT_PARALLEL_ID = "parent_parallel_id"
    PARENT_PARALLEL_START_NODE_ID = "parent_parallel_start_node_id"
    PARALLEL_MODE_RUN_ID = "parallel_mode_run_id"
    ITERATION_DURATION_MAP = "iteration_duration_map"  # single iteration duration if iteration node runs
    LOOP_DURATION_MAP = "loop_duration_map"  # single loop duration if loop node runs
    ERROR_STRATEGY = "error_strategy"  # node in continue on error mode return the field
    LOOP_VARIABLE_MAP = "loop_variable_map"  # single loop variable output
    DATASOURCE_INFO = "datasource_info"
    TRIGGER_INFO = "trigger_info"
    COMPLETED_REASON = "completed_reason"  # completed reason for loop node


class WorkflowNodeExecutionStatus(StrEnum):
    PENDING = "pending"  # Node is scheduled but not yet executing
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXCEPTION = "exception"
    STOPPED = "stopped"
    PAUSED = "paused"

    # Legacy statuses - kept for backward compatibility
    RETRY = "retry"  # Legacy: replaced by retry mechanism in error handling
