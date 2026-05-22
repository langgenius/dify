from configs.extra.agent_backend_config import AgentBackendConfig
from configs.extra.archive_config import ArchiveStorageConfig
from configs.extra.notion_config import NotionConfig
from configs.extra.sentry_config import SentryConfig


class ExtraServiceConfig(
    # place the configs in alphabet order
    AgentBackendConfig,
    ArchiveStorageConfig,
    NotionConfig,
    SentryConfig,
):
    pass
