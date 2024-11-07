from dify_oapi.core.model.config import Config

from .resource import Completion


class V1:
    def __init__(self, config: Config):
        self.completion: Completion = Completion(config)
