from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class EndNodeOutputType(Enum):
    """
    END Node Output Types.

    none, plain-text, structured
    """
    NONE = 'none'
    PLAIN_TEXT = 'plain-text'
    STRUCTURED = 'structured'

    @classmethod
    def value_of(cls, value: str) -> 'OutputType':
        """
        Get value of given output type.

        :param value: output type value
        :return: output type
        """
        for output_type in cls:
            if output_type.value == value:
                return output_type
        raise ValueError(f'invalid output type value {value}')


class EndNodeDataOutputs(BaseModel):
    """
    END Node Data Outputs.
    """
    class OutputType(Enum):
        """
        Output Types.
        """
        NONE = 'none'
        PLAIN_TEXT = 'plain-text'
        STRUCTURED = 'structured'

        @classmethod
        def value_of(cls, value: str) -> 'OutputType':
            """
            Get value of given output type.

            :param value: output type value
            :return: output type
            """
            for output_type in cls:
                if output_type.value == value:
                    return output_type
            raise ValueError(f'invalid output type value {value}')

    type: OutputType = OutputType.NONE
    plain_text_selector: Optional[list[str]] = None
    structured_variables: Optional[list[VariableSelector]] = None


class EndNodeData(BaseNodeData):
    """
    END Node Data.
    """
    outputs: Optional[EndNodeDataOutputs] = None
