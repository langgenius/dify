from enum import StrEnum


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
    # RAG Pipeline
    DOCUMENT_ID = "document_id"
    ORIGINAL_DOCUMENT_ID = "original_document_id"
    BATCH = "batch"
    DATASET_ID = "dataset_id"
    DATASOURCE_TYPE = "datasource_type"
    DATASOURCE_INFO = "datasource_info"
    INVOKE_FROM = "invoke_from"


class NodeType(StrEnum):
    START = "start"
    END = "end"
    ANSWER = "answer"
    LLM = "llm"
    KNOWLEDGE_RETRIEVAL = "knowledge-retrieval"
    KNOWLEDGE_INDEX = "knowledge-index"
    IF_ELSE = "if-else"
    CODE = "code"
    TEMPLATE_TRANSFORM = "template-transform"
    QUESTION_CLASSIFIER = "question-classifier"
    HTTP_REQUEST = "http-request"
    TOOL = "tool"
    DATASOURCE = "datasource"
    VARIABLE_AGGREGATOR = "variable-aggregator"
    LEGACY_VARIABLE_AGGREGATOR = "variable-assigner"  # TODO: Merge this into VARIABLE_AGGREGATOR in the database.
    LOOP = "loop"
    LOOP_START = "loop-start"
    LOOP_END = "loop-end"
    ITERATION = "iteration"
    ITERATION_START = "iteration-start"  # Fake start node for iteration.
    PARAMETER_EXTRACTOR = "parameter-extractor"
    VARIABLE_ASSIGNER = "assigner"
    DOCUMENT_EXTRACTOR = "document-extractor"
    LIST_OPERATOR = "list-operator"
    AGENT = "agent"
    HUMAN_INPUT = "human-input"


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
