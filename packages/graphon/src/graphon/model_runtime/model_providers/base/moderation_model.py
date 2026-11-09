import time
from collections.abc import Mapping

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.protocols.moderation_runtime import (
    ModerationModelRuntime,
)


class ModerationModel(AIModel[ModerationModelRuntime]):
    """Model class for moderation model."""

    model_type: ModelType = ModelType.MODERATION

    def invoke(
        self,
        model: str,
        credentials: dict,
        text: str,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> bool:
        """Invoke the moderation model and return whether the text is unsafe."""
        self.started_at = time.perf_counter()

        try:
            return self.model_runtime.invoke_moderation(
                provider=self.provider,
                model=model,
                credentials=credentials,
                text=text,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e
