from typing import TYPE_CHECKING
from .completions import Completions
from .async_completions import AsyncCompletions
from ...core._base_api import BaseAPI

if TYPE_CHECKING:
    from ..._client import ZhipuAI


class Chat(BaseAPI):
    completions: Completions

    def __init__(self, client: "ZhipuAI") -> None:
        super().__init__(client)
        self.completions = Completions(client)
        self.asyncCompletions = AsyncCompletions(client)
