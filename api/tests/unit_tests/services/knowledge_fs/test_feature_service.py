"""Tests for the KnowledgeFS deployment availability policy."""

from collections.abc import Callable

import pytest

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.knowledge_fs.feature_service import KnowledgeFSFeatures, get_knowledge_fs_features


def test_system_features_do_not_expose_knowledge_fs_availability() -> None:
    fields = SystemFeatureModel.model_fields

    assert "knowledge_fs_enabled" not in fields
    assert "knowledge_fs_upload_enabled" not in fields
    assert "agent_knowledge_fs_enabled" not in fields


@pytest.mark.parametrize(
    ("enabled", "base_url", "capability_enabled", "signing_ready", "upload_enabled"),
    [
        (True, "https://knowledge-fs.test", True, True, True),
        (True, None, True, True, False),
        (True, "https://knowledge-fs.test", False, True, False),
        (True, "https://knowledge-fs.test", True, False, False),
        (False, "https://knowledge-fs.test", True, True, False),
    ],
)
def test_get_knowledge_fs_features_reads_upload_availability(
    config_overrides: Callable[..., None],
    enabled: bool,
    base_url: str | None,
    capability_enabled: bool,
    signing_ready: bool,
    upload_enabled: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        KNOWLEDGE_FS_ENABLED=enabled,
        KNOWLEDGE_FS_BASE_URL=base_url,
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=capability_enabled,
        KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="signing-key" if signing_ready else None,
        KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=object() if signing_ready else None,
        AGENT_SHELL_ENABLED=True,
    )

    assert get_knowledge_fs_features() == KnowledgeFSFeatures(
        enabled=enabled,
        upload_enabled=upload_enabled,
        agent_enabled=upload_enabled,
    )


def test_get_knowledge_fs_features_requires_agent_shell_for_agents(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.test",
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
        KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="signing-key",
        KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=object(),
        AGENT_SHELL_ENABLED=False,
    )

    features = get_knowledge_fs_features()

    assert features.upload_enabled is True
    assert features.agent_enabled is False


@pytest.mark.parametrize(
    ("edition", "community_dev_enabled", "expected"),
    [
        (DeploymentEdition.ENTERPRISE, False, True),
        (DeploymentEdition.COMMUNITY, False, False),
        (DeploymentEdition.COMMUNITY, True, True),
    ],
)
def test_get_knowledge_fs_features_controls_availability_by_edition_or_development_flag(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    community_dev_enabled: bool,
    expected: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=edition,
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=community_dev_enabled,
    )

    assert get_knowledge_fs_features().enabled is expected
