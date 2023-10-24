from core.moderation.base import BaseModeration
from core.helper.extensible import Extensible

class CloudServiceModeration(BaseModeration, Extensible):
    register_name = "cloud_service"