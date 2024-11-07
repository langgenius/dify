from dify_oapi.core.model.config import Config

from .v1.version import V1


class ChatService:
    def __init__(self, config: Config) -> None:
        self.v1: V1 = V1(config)
