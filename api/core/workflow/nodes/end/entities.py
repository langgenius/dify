from enum import Enum


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
