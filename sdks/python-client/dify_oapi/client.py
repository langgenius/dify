from __future__ import annotations

from .api.chat.service import ChatService
from .api.completion.service import CompletionService
from .api.dify.service import DifyService
from .api.workflow.service import WorkflowService
from .api.knowledge_base.service import KnowledgeBaseService
from .core.http.transport import Transport
from .core.log import logger
from .core.model.base_request import BaseRequest
from .core.model.config import Config


class Client:
    def __init__(self):
        self._config: Config | None = None
        self.chat: ChatService | None = None
        self.completion: CompletionService | None = None
        self.dify: DifyService | None = None
        self.workflow: WorkflowService | None = None
        self.knowledge_base: KnowledgeBaseService | None = None

    def request(self, request: BaseRequest):
        resp = Transport.execute(self._config, request)
        return resp

    @staticmethod
    def builder() -> ClientBuilder:
        return ClientBuilder()


class ClientBuilder:
    def __init__(self) -> None:
        self._config = Config()

    def domain(self, domain: str) -> ClientBuilder:
        self._config.domain = domain
        return self

    def build(self) -> Client:
        client: Client = Client()
        client._config = self._config

        # 初始化日志
        self._init_logger()

        # 初始化 服务
        client.chat = ChatService(self._config)
        client.completion = CompletionService(self._config)
        client.dify = DifyService(self._config)
        client.workflow = WorkflowService(self._config)
        client.knowledge_base = KnowledgeBaseService(self._config)
        return client

    def _init_logger(self):
        logger.setLevel(int(self._config.log_level.value))
