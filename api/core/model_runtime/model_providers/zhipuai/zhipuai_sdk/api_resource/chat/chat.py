from typing import TYPE_CHECKING
from .completions import Completions
from .async_completions import AsyncCompletions
from ...core import BaseAPI, cached_property

if TYPE_CHECKING:
    from ..._client import ZhipuAI


class Chat(BaseAPI):

    @cached_property
    def completions(self) -> Completions:
        return Completions(self._client)

    @cached_property
    def asyncCompletions(self) -> AsyncCompletions:
        return AsyncCompletions(self._client)