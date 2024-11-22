class PluginDaemonError(Exception):
    """Base class for all plugin daemon errors."""

    def __init__(self, description: str) -> None:
        self.description = description


class PluginDaemonInternalServerError(PluginDaemonError):
    description: str = "Internal Server Error"


class PluginDaemonBadRequestError(PluginDaemonError):
    description: str = "Bad Request"


class PluginDaemonNotFoundError(PluginDaemonError):
    description: str = "Not Found"


class PluginUniqueIdentifierError(PluginDaemonError):
    description: str = "Unique Identifier Error"


class PluginNotFoundError(PluginDaemonError):
    description: str = "Plugin Not Found"


class PluginDaemonUnauthorizedError(PluginDaemonError):
    description: str = "Unauthorized"


class PluginPermissionDeniedError(PluginDaemonError):
    description: str = "Permission Denied"
