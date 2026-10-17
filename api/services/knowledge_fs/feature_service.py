"""Deployment availability of the KnowledgeFS product surfaces."""

from dataclasses import dataclass

from configs import dify_config
from enums import DeploymentEdition


@dataclass(frozen=True)
class KnowledgeFSFeatures:
    enabled: bool
    upload_enabled: bool
    # Deployment configuration only; sandbox protocol readiness is checked at run admission.
    agent_enabled: bool


def get_knowledge_fs_features() -> KnowledgeFSFeatures:
    """Resolve which KnowledgeFS surfaces this deployment offers to signed-in Console users."""
    enabled = bool(
        dify_config.KNOWLEDGE_FS_ENABLED
        and (
            dify_config.DEPLOYMENT_EDITION in {DeploymentEdition.CLOUD, DeploymentEdition.ENTERPRISE}
            or dify_config.KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED
        )
    )
    upload_enabled = bool(
        enabled
        and dify_config.KNOWLEDGE_FS_BASE_URL
        and dify_config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED
        and dify_config.KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID
        and dify_config.KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM
    )
    return KnowledgeFSFeatures(
        enabled=enabled,
        upload_enabled=upload_enabled,
        agent_enabled=bool(upload_enabled and dify_config.AGENT_SHELL_ENABLED),
    )
