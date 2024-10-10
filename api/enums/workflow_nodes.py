from enum import Enum


class NodeType(str, Enum):
    START = "start"
    END = "end"
    ANSWER = "answer"
    LLM = "llm"
    KNOWLEDGE_RETRIEVAL = "knowledge-retrieval"
    IF_ELSE = "if-else"
    CODE = "code"
    TEMPLATE_TRANSFORM = "template-transform"
    QUESTION_CLASSIFIER = "question-classifier"
    HTTP_REQUEST = "http-request"
    TOOL = "tool"
    VARIABLE_AGGREGATOR = "variable-aggregator"
    VARIABLE_ASSIGNER = "variable-assigner"  # TODO: Merge this into VARIABLE_AGGREGATOR in the database.
    LOOP = "loop"
    ITERATION = "iteration"
    ITERATION_START = "iteration-start"  # Fake start node for iteration.
    PARAMETER_EXTRACTOR = "parameter-extractor"
    CONVERSATION_VARIABLE_ASSIGNER = "assigner"
    DOCUMENT_EXTRACTOR = "document-extractor"
    LIST_FILTER = "list-filter"

    @classmethod
    def value_of(cls, value: str):
        """
        Get value of given node type.

        :param value: node type value
        :return: node type
        """
        for node_type in cls:
            if node_type.value == value:
                return node_type
        raise ValueError(f"invalid node type value {value}")
