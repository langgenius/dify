from enum import Enum


class CreatedByRole(str, Enum):
    ACCOUNT = "account"
    END_USER = "end_user"


class UserFrom(str, Enum):
    ACCOUNT = "account"
    END_USER = "end-user"


class WorkflowRunTriggeredFrom(str, Enum):
    DEBUGGING = "debugging"
    APP_RUN = "app-run"
