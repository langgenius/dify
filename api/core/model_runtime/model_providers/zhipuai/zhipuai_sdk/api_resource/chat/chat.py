from typing import TYPE_CHECKING

from ...core import BaseAPI, cached_property
from .async_completions import AsyncCompletions
from .completions import Completions

if TYPE_CHECKING:
    pass


class Chat(BaseAPI):
    @cached_property
    def completions(self) -> Completions:
        return Completions(self._client)

    @cached_property
    def asyncCompletions(self) -> AsyncCompletions:  # noqa: N802
        return AsyncCompletions(self._client)
