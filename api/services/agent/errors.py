from werkzeug.exceptions import BadRequest, Conflict, NotFound


class AgentNotFoundError(NotFound):
    description = "Agent not found."


class AgentVersionNotFoundError(NotFound):
    description = "Agent config version not found."


class AgentNameConflictError(Conflict):
    description = "Agent name already exists."


class AgentArchivedError(Conflict):
    description = "Archived agent cannot be modified."


class AgentSoulLockedError(BadRequest):
    description = "Agent Soul is locked for this workflow node."


class InvalidComposerConfigError(BadRequest):
    description = "Invalid agent composer config."


class PlaintextSecretNotAllowedError(BadRequest):
    description = "Plaintext secret values are not allowed in Agent config."
