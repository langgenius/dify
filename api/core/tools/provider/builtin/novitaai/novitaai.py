from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.novitaai.tools.novitaai_txt2img import NovitaAiTxt2ImgTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class NovitaAIProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            result = (
                NovitaAiTxt2ImgTool()
                .fork_tool_runtime(
                    runtime={
                        "credentials": credentials,
                    }
                )
                .invoke(
                    user_id="",
                    tool_parameters={
                        "model_name": "cinenautXLATRUE_cinenautV10_392434.safetensors",
                        "prompt": "a futuristic city with flying cars",
                        "negative_prompt": "",
                        "width": 128,
                        "height": 128,
                        "image_num": 1,
                        "guidance_scale": 7.5,
                        "seed": -1,
                        "steps": 1,
                    },
                )
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
