"""Account sign-in vocabulary shared by transport and application code."""

from enum import StrEnum


class LoginMode(StrEnum):
    CONSOLE = "console"
    END_USER = "end_user"
