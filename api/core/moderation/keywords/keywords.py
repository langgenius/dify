from collections.abc import Sequence
from typing import Any

from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult


class KeywordsModeration(Moderation):
    name: str = "keywords"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        cls._validate_inputs_and_outputs_config(config, True)

        if not config.get("keywords"):
            raise ValueError("keywords is required")

        if len(config.get("keywords")) > 10000:
            raise ValueError("keywords length must be less than 10000")

        keywords_row_len = config["keywords"].split("\n")
        if len(keywords_row_len) > 100:
            raise ValueError("the number of rows for the keywords must be less than 100")

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        flagged = False
        preset_response = ""

        if self.config["inputs_config"]["enabled"]:
            preset_response = self.config["inputs_config"]["preset_response"]

            if query:
                inputs["query__"] = query

            # Filter out empty values
            keywords_list = [keyword for keyword in self.config["keywords"].split("\n") if keyword]

            flagged = self._is_violated(inputs, keywords_list)

        return ModerationInputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        flagged = False
        preset_response = ""

        if self.config["outputs_config"]["enabled"]:
            # Filter out empty values
            keywords_list = [keyword for keyword in self.config["keywords"].split("\n") if keyword]

            flagged = self._is_violated({"text": text}, keywords_list)
            preset_response = self.config["outputs_config"]["preset_response"]

        return ModerationOutputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    def _is_violated(self, inputs: dict, keywords_list: list) -> bool:
        return any(self._check_keywords_in_value(keywords_list, value) for value in inputs.values())

    def _check_keywords_in_value(self, keywords_list: Sequence[str], value: Any) -> bool:
        return any(keyword.lower() in str(value).lower() for keyword in keywords_list)
