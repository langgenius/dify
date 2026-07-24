from enum import StrEnum


class DeploymentEdition(StrEnum):
    """
    Enum representing the deployment edition of the platform.
    """

    COMMUNITY = "COMMUNITY"
    ENTERPRISE = "ENTERPRISE"
    CLOUD = "CLOUD"
