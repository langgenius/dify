from collections.abc import Callable
from inspect import unwrap

from controllers.console.knowledge_fs.features import KnowledgeFSFeaturesApi


def test_get_knowledge_fs_features_serializes_deployment_availability(config_overrides: Callable[..., None]) -> None:
    config_overrides(KNOWLEDGE_FS_ENABLED=False)

    result = unwrap(KnowledgeFSFeaturesApi.get)(KnowledgeFSFeaturesApi())

    assert result == {"enabled": False, "upload_enabled": False, "agent_enabled": False}
