from enum import Enum


class SystemVariable(str, Enum):
    """
    System Variables.
    """
    QUERY = 'query'
    FILES = 'files'
    CONVERSATION_ID = 'conversation_id'
    USER_ID = 'user_id'
    DIALOGUE_COUNT = 'dialogue_count'

    @classmethod
    def value_of(cls, value: str):
        """
        Get value of given system variable.

        :param value: system variable value
        :return: system variable
        """
        for system_variable in cls:
            if system_variable.value == value:
                return system_variable
        raise ValueError(f'invalid system variable value {value}')
