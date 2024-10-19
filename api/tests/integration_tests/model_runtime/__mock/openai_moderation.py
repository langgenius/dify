import re
from typing import Any, Literal, Union

from openai._types import NOT_GIVEN, NotGiven
from openai.resources.moderations import Moderations
from openai.types import ModerationCreateResponse
from openai.types.moderation import Categories, CategoryScores, Moderation

from core.model_runtime.errors.invoke import InvokeAuthorizationError


class MockModerationClass:
    def moderation_create(
        self: Moderations,
        *,
        input: Union[str, list[str]],
        model: Union[str, Literal["text-moderation-latest", "text-moderation-stable"]] | NotGiven = NOT_GIVEN,
        **kwargs: Any,
    ) -> ModerationCreateResponse:
        if isinstance(input, str):
            input = [input]

        if not re.match(r"^(https?):\/\/[^\s\/$.?#].[^\s]*$", str(self._client.base_url)):
            raise InvokeAuthorizationError("Invalid base url")

        if len(self._client.api_key) < 18:
            raise InvokeAuthorizationError("Invalid API key")

        for text in input:
            result = []
            if "kill" in text:
                moderation_categories = {
                    "harassment": False,
                    "harassment/threatening": False,
                    "hate": False,
                    "hate/threatening": False,
                    "self-harm": False,
                    "self-harm/instructions": False,
                    "self-harm/intent": False,
                    "sexual": False,
                    "sexual/minors": False,
                    "violence": False,
                    "violence/graphic": False,
                    "illicit": False,
                    "illicit/violent": False,
                }
                moderation_categories_scores = {
                    "harassment": 1.0,
                    "harassment/threatening": 1.0,
                    "hate": 1.0,
                    "hate/threatening": 1.0,
                    "self-harm": 1.0,
                    "self-harm/instructions": 1.0,
                    "self-harm/intent": 1.0,
                    "sexual": 1.0,
                    "sexual/minors": 1.0,
                    "violence": 1.0,
                    "violence/graphic": 1.0,
                    "illicit": 1.0,
                    "illicit/violent": 1.0,
                }
                category_applied_input_types = {
                    "sexual": ["text", "image"],
                    "hate": ["text"],
                    "harassment": ["text"],
                    "self-harm": ["text", "image"],
                    "sexual/minors": ["text"],
                    "hate/threatening": ["text"],
                    "violence/graphic": ["text", "image"],
                    "self-harm/intent": ["text", "image"],
                    "self-harm/instructions": ["text", "image"],
                    "harassment/threatening": ["text"],
                    "violence": ["text", "image"],
                    "illicit": ["text"],
                    "illicit/violent": ["text"],
                }
                result.append(
                    Moderation(
                        flagged=True,
                        categories=Categories(**moderation_categories),
                        category_scores=CategoryScores(**moderation_categories_scores),
                        category_applied_input_types=category_applied_input_types,
                    )
                )
            else:
                moderation_categories = {
                    "harassment": False,
                    "harassment/threatening": False,
                    "hate": False,
                    "hate/threatening": False,
                    "self-harm": False,
                    "self-harm/instructions": False,
                    "self-harm/intent": False,
                    "sexual": False,
                    "sexual/minors": False,
                    "violence": False,
                    "violence/graphic": False,
                    "illicit": False,
                    "illicit/violent": False,
                }
                moderation_categories_scores = {
                    "harassment": 0.0,
                    "harassment/threatening": 0.0,
                    "hate": 0.0,
                    "hate/threatening": 0.0,
                    "self-harm": 0.0,
                    "self-harm/instructions": 0.0,
                    "self-harm/intent": 0.0,
                    "sexual": 0.0,
                    "sexual/minors": 0.0,
                    "violence": 0.0,
                    "violence/graphic": 0.0,
                    "illicit": 0.0,
                    "illicit/violent": 0.0,
                }
                category_applied_input_types = {
                    "sexual": ["text", "image"],
                    "hate": ["text"],
                    "harassment": ["text"],
                    "self-harm": ["text", "image"],
                    "sexual/minors": ["text"],
                    "hate/threatening": ["text"],
                    "violence/graphic": ["text", "image"],
                    "self-harm/intent": ["text", "image"],
                    "self-harm/instructions": ["text", "image"],
                    "harassment/threatening": ["text"],
                    "violence": ["text", "image"],
                    "illicit": ["text"],
                    "illicit/violent": ["text"],
                }
                result.append(
                    Moderation(
                        flagged=False,
                        categories=Categories(**moderation_categories),
                        category_scores=CategoryScores(**moderation_categories_scores),
                        category_applied_input_types=category_applied_input_types,
                    )
                )

        return ModerationCreateResponse(id="shiroii kuloko", model=model, results=result)
