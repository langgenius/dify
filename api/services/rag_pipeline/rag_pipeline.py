import datetime
import hashlib
import os
import uuid
from typing import Any, List, Literal, Union

from flask_login import current_user

from models.dataset import PipelineBuiltInTemplate, PipelineCustomizedTemplate  # type: ignore


class RagPipelineService:
    @staticmethod
    def get_pipeline_templates(
        type: Literal["built-in", "customized"] = "built-in",
    ) -> list[PipelineBuiltInTemplate | PipelineCustomizedTemplate]:
        if type == "built-in":
            return PipelineBuiltInTemplate.query.all()
        else:
            return PipelineCustomizedTemplate.query.all()
