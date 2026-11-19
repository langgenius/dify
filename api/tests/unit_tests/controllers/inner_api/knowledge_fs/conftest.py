"""Enable KnowledgeFS for tests of its trusted inner API routes."""

from collections.abc import Callable

import pytest

from enums import DeploymentEdition


@pytest.fixture(autouse=True)
def _enabled_knowledge_fs(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=True,
    )
