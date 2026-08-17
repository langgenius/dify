from configs.extra.agent_backend_config import AgentBackendConfig
from configs.extra.archive_config import ArchiveStorageConfig
from configs.extra.knowledge_fs_config import KnowledgeFSConfig
from configs.extra.notion_config import NotionConfig
from configs.extra.public_storage_config import PublicStorageConfig
from configs.extra.sentry_config import SentryConfig
from configs.extra.turnstile_config import TurnstileConfig


class ExtraServiceConfig(
    # place the configs in alphabet order
    AgentBackendConfig,
    ArchiveStorageConfig,
    KnowledgeFSConfig,
    NotionConfig,
    PublicStorageConfig,
    SentryConfig,
    TurnstileConfig,
):
    pass
