from base64 import b64decode
from copy import deepcopy
from typing import Any, Union

from novita_client import (
    NovitaClient,
    Txt2ImgV3Embedding,
    Txt2ImgV3HiresFix,
    Txt2ImgV3LoRA,
    Txt2ImgV3Refiner,
    V3TaskImage,
)

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class NovitaAiTxt2ImgTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        if 'api_key' not in self.runtime.credentials or not self.runtime.credentials.get('api_key'):
            raise ToolProviderCredentialValidationError("Novita AI API Key is required.")

        api_key = self.runtime.credentials.get('api_key')

        client = NovitaClient(api_key=api_key)
        param = self._process_parameters(tool_parameters)
        client_result = client.txt2img_v3(**param)

        results = []
        for image_encoded, image in zip(client_result.images_encoded, client_result.images):
            if self._is_hit_nsfw_detection(image, 0.8):
                results = self.create_text_message(text='NSFW detected!')
                break

            results.append(
                self.create_blob_message(blob=b64decode(image_encoded),
                                         meta={'mime_type': f'image/{image.image_type}'},
                                         save_as=self.VARIABLE_KEY.IMAGE.value)
            )

        return results

    def _process_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
            process parameters
        """
        res_parameters = deepcopy(parameters)

        # delete none and empty
        keys_to_delete = [k for k, v in res_parameters.items() if v is None or v == '']
        for k in keys_to_delete:
            del res_parameters[k]

        if 'clip_skip' in res_parameters and res_parameters.get('clip_skip') == 0:
            del res_parameters['clip_skip']

        if 'refiner_switch_at' in res_parameters and res_parameters.get('refiner_switch_at') == 0:
            del res_parameters['refiner_switch_at']

        if 'enabled_enterprise_plan' in res_parameters:
            res_parameters['enterprise_plan'] = {'enabled': res_parameters['enabled_enterprise_plan']}
            del res_parameters['enabled_enterprise_plan']

        if 'nsfw_detection_level' in res_parameters:
            res_parameters['nsfw_detection_level'] = int(res_parameters['nsfw_detection_level'])

        # process loras
        if 'loras' in res_parameters:
            loras_ori_list = res_parameters.get('loras').strip().split(';')
            locals_list = []
            for lora_str in loras_ori_list:
                lora_info = lora_str.strip().split(',')
                lora = Txt2ImgV3LoRA(
                    model_name=lora_info[0].strip(),
                    strength=float(lora_info[1]),
                )
                locals_list.append(lora)

            res_parameters['loras'] = locals_list

        # process embeddings
        if 'embeddings' in res_parameters:
            embeddings_ori_list = res_parameters.get('embeddings').strip().split(';')
            locals_list = []
            for embedding_str in embeddings_ori_list:
                embedding = Txt2ImgV3Embedding(
                    model_name=embedding_str.strip()
                )
                locals_list.append(embedding)

            res_parameters['embeddings'] = locals_list

        # process hires_fix
        if 'hires_fix' in res_parameters:
            hires_fix_ori = res_parameters.get('hires_fix')
            hires_fix_info = hires_fix_ori.strip().split(',')
            if 'upscaler' in hires_fix_info:
                hires_fix = Txt2ImgV3HiresFix(
                    target_width=int(hires_fix_info[0]),
                    target_height=int(hires_fix_info[1]),
                    strength=float(hires_fix_info[2]),
                    upscaler=hires_fix_info[3].strip()
                )
            else:
                hires_fix = Txt2ImgV3HiresFix(
                    target_width=int(hires_fix_info[0]),
                    target_height=int(hires_fix_info[1]),
                    strength=float(hires_fix_info[2])
                )

            res_parameters['hires_fix'] = hires_fix

            if 'refiner_switch_at' in res_parameters:
                refiner = Txt2ImgV3Refiner(
                    switch_at=float(res_parameters.get('refiner_switch_at'))
                )
                del res_parameters['refiner_switch_at']
                res_parameters['refiner'] = refiner

        return res_parameters

    def _is_hit_nsfw_detection(self, image: V3TaskImage, confidence_threshold: float) -> bool:
        """
            is hit nsfw
        """
        if image.nsfw_detection_result is None:
            return False
        if image.nsfw_detection_result.valid and image.nsfw_detection_result.confidence >= confidence_threshold:
            return True
        return False
