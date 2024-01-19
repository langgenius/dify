from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from os.path import join
from base64 import b64decode

import json

from copy import deepcopy

DRAW_OPTIONS = {
    "prompt": "",
    "negative_prompt": "",
    "seed": -1,
    "subseed": -1,
    "subseed_strength": 0,
    "seed_resize_from_h": -1,
    'sampler_index': 'DPM++ SDE Karras',
    "seed_resize_from_w": -1,
    "batch_size": 1,
    "n_iter": 1,
    "steps": 10,
    "cfg_scale": 7,
    "width": 1024,
    "height": 1024,
    "restore_faces": False,
    "do_not_save_samples": False,
    "do_not_save_grid": False,
    "eta": 0,
    "denoising_strength": 0,
    "s_min_uncond": 0,
    "s_churn": 0,
    "s_tmax": 0,
    "s_tmin": 0,
    "s_noise": 0,
    "override_settings": {},
    "override_settings_restore_afterwards": True,
    "refiner_switch_at": 0,
    "disable_extra_networks": False,
    "comments": {},
    "enable_hr": False,
    "firstphase_width": 0,
    "firstphase_height": 0,
    "hr_scale": 2,
    "hr_second_pass_steps": 0,
    "hr_resize_x": 0,
    "hr_resize_y": 0,
    "hr_prompt": "",
    "hr_negative_prompt": "",
    "script_args": [],
    "send_images": True,
    "save_images": False,
    "alwayson_scripts": {}
}

class StableDiffusionTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_paramters: Dict[str, Any]) \
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # base url
        base_url = self.runtime.credentials.get('base_url', None)
        if not base_url:
            return self.create_text_message('Please input base_url')
        model = self.runtime.credentials.get('model', None)
        if not model:
            return self.create_text_message('Please input model')
        
        # set model
        try:
            url = join(base_url, 'sdapi/v1/options')
            response = post(url, data=json.dumps({
                'sd_model_checkpoint': model
            }))
            if response.status_code != 200:
                raise ToolProviderCredentialValidationError('Failed to set model, please tell user to set model')
        except Exception as e:
            raise ToolProviderCredentialValidationError('Failed to set model, please tell user to set model')

        
        # prompt
        prompt = tool_paramters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        
        # get size
        width = tool_paramters.get('width', 1024)
        height = tool_paramters.get('height', 1024)

        # get steps
        steps = tool_paramters.get('steps', 1)

        # get lora
        lora = tool_paramters.get('lora', '')

        # copy draw options
        draw_options = deepcopy(DRAW_OPTIONS)

        if lora:
            draw_options['prompt'] = f'{lora},{prompt}'

        draw_options['width'] = width
        draw_options['height'] = height
        draw_options['steps'] = steps
        
        try:
            url = join(base_url, 'sdapi/v1/txt2img')
            response = post(url, data=json.dumps(draw_options), timeout=120)
            if response.status_code != 200:
                return self.create_text_message('Failed to generate image')
            
            image = response.json()['images'][0]

            return self.create_blob_message(blob=b64decode(image), 
                                            meta={ 'mime_type': 'image/png' },
                                            save_as=self.VARIABLE_KEY.IMAGE.value)
            
        except Exception as e:
            return self.create_text_message('Failed to generate image')
