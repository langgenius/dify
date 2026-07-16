from enum import Enum


class KnowledgeSpaceCreationResponseConfigurationStatus(str, Enum):
    PENDING_VALIDATION = "pending-validation"
    READY = "ready"
    SETUP_REQUIRED = "setup-required"
    VALIDATION_FAILED = "validation-failed"

    def __str__(self) -> str:
        return str(self.value)
