from typing import TYPE_CHECKING

from ...core._base_api import BaseAPI
from .jobs import Jobs

if TYPE_CHECKING:
    from ..._client import ZhipuAI


class FineTuning(BaseAPI):
    jobs: Jobs

    def __init__(self, client: "ZhipuAI") -> None:
        super().__init__(client)
        self.jobs = Jobs(client)
