from enum import Enum

from sqlalchemy import CHAR, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID


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


class StringUUID(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return str(value)
        else:
            return value.hex

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)
