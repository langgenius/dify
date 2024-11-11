from enum import Enum


class RecommendAppType(str, Enum):
    REMOTE = "remote"
    BUILDIN = "builtin"
    DATABASE = "db"
