"""Resource access token vocabulary shared by persistence and application services."""

from enum import StrEnum

TOKEN_PREFIX = "sk-"


class ResourceAccessTokenResourceType(StrEnum):
    APP = "app"
    KNOWLEDGE = "knowledge"
