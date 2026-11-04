"""Failures shared by Web execution admission and Guest migration."""


class EndUserBusyError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("This Web App identity is being updated. Please retry.")


class WebExecutionResourcesChangedError(ValueError):
    def __init__(self) -> None:
        super().__init__("Web App resources changed before execution. Refresh and retry.")
