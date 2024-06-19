from pydantic import BaseModel

from configs.extra.notion_configs import NotionConfigs
from configs.extra.sentry_configs import SentryConfigs


class ExtraServiceConfigs(
    # place the configs in alphabet order
    NotionConfigs,
    SentryConfigs,
):
    pass
