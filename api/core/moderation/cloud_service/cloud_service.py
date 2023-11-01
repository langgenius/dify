from typing import Optional

from core.moderation.base import Moderation


class CloudServiceModeration(Moderation):
    name: str = "cloud_service"

    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        pass

    def moderation_for_outputs(self, text: str):
        pass