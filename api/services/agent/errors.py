from werkzeug.exceptions import BadRequest, Conflict, NotFound

from libs.exception import BaseHTTPException


class AgentNotFoundError(NotFound):
    description = "Agent not found."


class AgentVersionNotFoundError(NotFound):
    description = "Agent config version not found."


class AgentNameConflictError(Conflict):
    description = "Agent name already exists."


class AgentArchivedError(Conflict):
    description = "Archived agent cannot be modified."


class AgentVersionConflictError(Conflict):
    description = "Agent config version changed. Please reload and try again."


class AgentModelNotConfiguredError(BaseHTTPException):
    error_code = "agent_model_not_configured"
    description = "Agent App requires the Agent Soul model to be configured."
    code = 400


class AgentSoulLockedError(BadRequest):
    description = "Agent Soul is locked for this workflow node."


class InvalidComposerConfigError(BadRequest):
    description = "Invalid agent composer config."


class PlaintextSecretNotAllowedError(BadRequest):
    description = "Plaintext secret values are not allowed in Agent config."
