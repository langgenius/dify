from base64 import b64decode
from copy import deepcopy
from typing import Any, Union

from novita_client import (  # type: ignore
    NovitaClient,
)

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.novitaai._novita_tool_base import NovitaAiToolBase
from core.tools.tool.builtin_tool import BuiltinTool


class NovitaAiTxt2ImgTool(BuiltinTool, NovitaAiToolBase):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        if "api_key" not in self.runtime.credentials or not self.runtime.credentials.get("api_key"):
            raise ToolProviderCredentialValidationError("Novita AI API Key is required.")

        api_key = self.runtime.credentials.get("api_key")

        client = NovitaClient(api_key=api_key)
        param = self._process_parameters(tool_parameters)
        client_result = client.txt2img_v3(**param)

        results = []
        for image_encoded, image in zip(client_result.images_encoded, client_result.images):
            if self._is_hit_nsfw_detection(image, 0.8):
                results = self.create_text_message(text="NSFW detected!")
                break

            results.append(
                self.create_blob_message(
                    blob=b64decode(image_encoded),
                    meta={"mime_type": f"image/{image.image_type}"},
                    save_as=self.VariableKey.IMAGE.value,
                )
            )

        return results

    def _process_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        process parameters
        """
        res_parameters = deepcopy(parameters)

        # delete none and empty
        keys_to_delete = [k for k, v in res_parameters.items() if v is None or v == ""]
        for k in keys_to_delete:
            del res_parameters[k]

        if "clip_skip" in res_parameters and res_parameters.get("clip_skip") == 0:
            del res_parameters["clip_skip"]

        if "refiner_switch_at" in res_parameters and res_parameters.get("refiner_switch_at") == 0:
            del res_parameters["refiner_switch_at"]

        if "enabled_enterprise_plan" in res_parameters:
            res_parameters["enterprise_plan"] = {"enabled": res_parameters["enabled_enterprise_plan"]}
            del res_parameters["enabled_enterprise_plan"]

        if "nsfw_detection_level" in res_parameters:
            res_parameters["nsfw_detection_level"] = int(res_parameters["nsfw_detection_level"])

        # process loras
        if "loras" in res_parameters:
            res_parameters["loras"] = self._extract_loras(res_parameters.get("loras"))

        # process embeddings
        if "embeddings" in res_parameters:
            res_parameters["embeddings"] = self._extract_embeddings(res_parameters.get("embeddings"))

        # process hires_fix
        if "hires_fix" in res_parameters:
            res_parameters["hires_fix"] = self._extract_hires_fix(res_parameters.get("hires_fix"))

        # process refiner
        if "refiner_switch_at" in res_parameters:
            res_parameters["refiner"] = self._extract_refiner(res_parameters.get("refiner_switch_at"))
            del res_parameters["refiner_switch_at"]

        return res_parameters
