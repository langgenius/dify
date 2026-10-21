"""Safe domain failures; controllers own HTTP codes and serialization.

An absent or foreign Connection produces the same not-found failure. Identity
failures belong to authentication; invalid requests/configurations, stale targets,
and changed credentials must remain distinguishable. Never attach provider error
payloads or credentials to these exceptions.
"""


class ConnectionError(Exception):
    """Base for personal Connection management failures."""


class ConnectionIdentityError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Invalid connection identity.")


class ConnectionNotFoundError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Connection not found.")


class ConnectionConfigurationError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("The connection is not compatible with this tool configuration.")


class ConnectionWorkflowChangedError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("The workflow configuration changed. Confirm the connection selection again.")


class ConnectionReauthorizationRequiredError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("The OAuth client changed or is unavailable. Reauthorization is required.")


class ConnectionConflictError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Connection changed during the operation.")


class ConnectionCheckUnavailableError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Credential validation is temporarily unavailable.")


class ConnectionInvalidCredentialsError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Invalid credentials for this provider.")


class ConnectionSecretUnavailableError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Connection credentials are temporarily unavailable.")
