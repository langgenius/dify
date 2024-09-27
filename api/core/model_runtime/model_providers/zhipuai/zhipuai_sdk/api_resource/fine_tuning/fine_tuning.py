from typing import TYPE_CHECKING

from ...core import BaseAPI, cached_property
from .jobs import Jobs
from .models import FineTunedModels

if TYPE_CHECKING:
    pass


class FineTuning(BaseAPI):
    @cached_property
    def jobs(self) -> Jobs:
        return Jobs(self._client)

    @cached_property
    def models(self) -> FineTunedModels:
        return FineTunedModels(self._client)
