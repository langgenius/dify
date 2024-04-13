from enum import Enum


class CreatedByRole(Enum):
    """
    Enum class for createdByRole
    """
    ACCOUNT = "account"
    END_USER = "end_user"

    @classmethod
    def value_of(cls, value: str) -> 'CreatedByRole':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for role in cls:
            if role.value == value:
                return role
        raise ValueError(f'invalid createdByRole value {value}')


class CreatedFrom(Enum):
    """
    Enum class for createdFrom
    """
    SERVICE_API = "service-api"
    WEB_APP = "web-app"
    EXPLORE = "explore"

    @classmethod
    def value_of(cls, value: str) -> 'CreatedFrom':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for role in cls:
            if role.value == value:
                return role
        raise ValueError(f'invalid createdFrom value {value}')
