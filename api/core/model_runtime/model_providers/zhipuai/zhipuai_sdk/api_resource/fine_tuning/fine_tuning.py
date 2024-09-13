from typing import TYPE_CHECKING
from .jobs import Jobs
from .models import FineTunedModels
from ...core import BaseAPI, cached_property

if TYPE_CHECKING:
    from ..._client import ZhipuAI


class FineTuning(BaseAPI):

    @cached_property
    def jobs(self) -> Jobs:
        return Jobs(self._client)

    @cached_property
    def models(self) -> FineTunedModels:
        return FineTunedModels(self._client)

