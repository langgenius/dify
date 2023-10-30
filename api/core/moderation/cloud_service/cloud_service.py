from core.moderation.base import BaseModeration
from core.helper.extensible import Extensible

class CloudServiceModeration(BaseModeration, Extensible):
    type = "cloud_service"