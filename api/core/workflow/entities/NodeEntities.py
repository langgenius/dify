from enum import Enum


class NodeType(Enum):
    """
    Node Types.
    """
    START = 'start'
    END = 'end'
    DIRECT_ANSWER = 'direct-answer'
    LLM = 'llm'
    KNOWLEDGE_RETRIEVAL = 'knowledge-retrieval'
    IF_ELSE = 'if-else'
    CODE = 'code'
    TEMPLATE_TRANSFORM = 'template-transform'
    QUESTION_CLASSIFIER = 'question-classifier'
    HTTP_REQUEST = 'http-request'
    TOOL = 'tool'
    VARIABLE_ASSIGNER = 'variable-assigner'

    @classmethod
    def value_of(cls, value: str) -> 'BlockType':
        """
        Get value of given block type.

        :param value: block type value
        :return: block type
        """
        for block_type in cls:
            if block_type.value == value:
                return block_type
        raise ValueError(f'invalid block type value {value}')
