import io
import json
from base64 import b64decode, b64encode
from copy import deepcopy
from typing import Any, Union

from httpx import get, post
from PIL import Image
from yarl import URL

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolInvokeMessage,
    ToolParameter,
    ToolParameterOption,
)
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool

# All commented out parameters default to null
DRAW_TEXT_OPTIONS = {
    # Prompts
    "prompt": "",
    "negative_prompt": "",
    # "styles": [],
    # Seeds
    "seed": -1,
    "subseed": -1,
    "subseed_strength": 0,
    "seed_resize_from_h": -1,
    "seed_resize_from_w": -1,
    # Samplers
    "sampler_name": "DPM++ 2M",
    # "scheduler": "",
    # "sampler_index": "Automatic",
    # Latent Space Options
    "batch_size": 1,
    "n_iter": 1,
    "steps": 10,
    "cfg_scale": 7,
    "width": 512,
    "height": 512,
    # "restore_faces": True,
    # "tiling": True,
    "do_not_save_samples": False,
    "do_not_save_grid": False,
    # "eta": 0,
    # "denoising_strength": 0.75,
    # "s_min_uncond": 0,
    # "s_churn": 0,
    # "s_tmax": 0,
    # "s_tmin": 0,
    # "s_noise": 0,
    "override_settings": {},
    "override_settings_restore_afterwards": True,
    # Refinement Options
    "refiner_checkpoint": "",
    "refiner_switch_at": 0,
    "disable_extra_networks": False,
    # "firstpass_image": "",
    # "comments": "",
    # High-Resolution Options
    "enable_hr": False,
    "firstphase_width": 0,
    "firstphase_height": 0,
    "hr_scale": 2,
    # "hr_upscaler": "",
    "hr_second_pass_steps": 0,
    "hr_resize_x": 0,
    "hr_resize_y": 0,
    # "hr_checkpoint_name": "",
    # "hr_sampler_name": "",
    # "hr_scheduler": "",
    "hr_prompt": "",
    "hr_negative_prompt": "",
    # Task Options
    # "force_task_id": "",
    # Script Options
    # "script_name": "",
    "script_args": [],
    # Output Options
    "send_images": True,
    "save_images": False,
    "alwayson_scripts": {},
    # "infotext": "",
}


class StableDiffusionTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # base url
        base_url = self.runtime.credentials.get("base_url", None)
        if not base_url:
            return self.create_text_message("Please input base_url")

        if tool_parameters.get("model"):
            self.runtime.credentials["model"] = tool_parameters["model"]

        model = self.runtime.credentials.get("model", None)
        if not model:
            return self.create_text_message("Please input model")
        api_key = self.runtime.credentials.get("api_key") or "abc"
        headers = {"Authorization": f"Bearer {api_key}"}
        # set model
        try:
            url = str(URL(base_url) / "sdapi" / "v1" / "options")
            response = post(
                url,
                json={"sd_model_checkpoint": model},
                headers=headers,
            )
            if response.status_code != 200:
                raise ToolProviderCredentialValidationError("Failed to set model, please tell user to set model")
        except Exception as e:
            raise ToolProviderCredentialValidationError("Failed to set model, please tell user to set model")

        # get image id and image variable
        image_id = tool_parameters.get("image_id", "")
        image_variable = self.get_default_image_variable()
        # Return text2img if there's no image ID or no image variable
        if not image_id or not image_variable:
            return self.text2img(base_url=base_url, tool_parameters=tool_parameters)

        # Proceed with image-to-image generation
        return self.img2img(base_url=base_url, tool_parameters=tool_parameters)

    def validate_models(self):
        """
        validate models
        """
        try:
            base_url = self.runtime.credentials.get("base_url", None)
            if not base_url:
                raise ToolProviderCredentialValidationError("Please input base_url")
            model = self.runtime.credentials.get("model", None)
            if not model:
                raise ToolProviderCredentialValidationError("Please input model")

            api_url = str(URL(base_url) / "sdapi" / "v1" / "sd-models")
            response = get(url=api_url, timeout=10)
            if response.status_code == 404:
                # try draw a picture
                self._invoke(
                    user_id="test",
                    tool_parameters={
                        "prompt": "a cat",
                        "width": 1024,
                        "height": 1024,
                        "steps": 1,
                        "lora": "",
                    },
                )
            elif response.status_code != 200:
                raise ToolProviderCredentialValidationError("Failed to get models")
            else:
                models = [d["model_name"] for d in response.json()]
                if len([d for d in models if d == model]) > 0:
                    return self.create_text_message(json.dumps(models))
                else:
                    raise ToolProviderCredentialValidationError(f"model {model} does not exist")
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Failed to get models, {e}")

    def get_sd_models(self) -> list[str]:
        """
        get sd models
        """
        try:
            base_url = self.runtime.credentials.get("base_url", None)
            if not base_url:
                return []
            api_url = str(URL(base_url) / "sdapi" / "v1" / "sd-models")
            response = get(url=api_url, timeout=120)
            if response.status_code != 200:
                return []
            else:
                return [d["model_name"] for d in response.json()]
        except Exception as e:
            return []

    def get_sample_methods(self) -> list[str]:
        """
        get sample method
        """
        try:
            base_url = self.runtime.credentials.get("base_url", None)
            if not base_url:
                return []
            api_url = str(URL(base_url) / "sdapi" / "v1" / "samplers")
            response = get(url=api_url, timeout=120)
            if response.status_code != 200:
                return []
            else:
                return [d["name"] for d in response.json()]
        except Exception as e:
            return []

    def img2img(
        self, base_url: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        generate image
        """

        # Fetch the binary data of the image
        image_variable = self.get_default_image_variable()
        image_binary = self.get_variable_file(image_variable.name)
        if not image_binary:
            return self.create_text_message("Image not found, please request user to generate image firstly.")

        # Convert image to RGB and save as PNG
        try:
            with Image.open(io.BytesIO(image_binary)) as image, io.BytesIO() as buffer:
                image.convert("RGB").save(buffer, format="PNG")
                image_binary = buffer.getvalue()
        except Exception as e:
            return self.create_text_message(f"Failed to process the image: {str(e)}")

        # copy draw options
        draw_options = deepcopy(DRAW_TEXT_OPTIONS)
        # set image options
        model = tool_parameters.get("model", "")
        draw_options_image = {
            "init_images": [b64encode(image_binary).decode("utf-8")],
            "denoising_strength": 0.9,
            "restore_faces": False,
            "script_args": [],
            "override_settings": {"sd_model_checkpoint": model},
            "resize_mode": 0,
            "image_cfg_scale": 0,
            # "mask": None,
            "mask_blur_x": 4,
            "mask_blur_y": 4,
            "mask_blur": 0,
            "mask_round": True,
            "inpainting_fill": 0,
            "inpaint_full_res": True,
            "inpaint_full_res_padding": 0,
            "inpainting_mask_invert": 0,
            "initial_noise_multiplier": 0,
            # "latent_mask": None,
            "include_init_images": True,
        }
        # update key and values
        draw_options.update(draw_options_image)
        draw_options.update(tool_parameters)

        # get prompt lora model
        prompt = tool_parameters.get("prompt", "")
        lora = tool_parameters.get("lora", "")
        model = tool_parameters.get("model", "")
        if lora:
            draw_options["prompt"] = f"{lora},{prompt}"
        else:
            draw_options["prompt"] = prompt
        api_key = self.runtime.credentials.get("api_key") or "abc"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            url = str(URL(base_url) / "sdapi" / "v1" / "img2img")
            response = post(
                url,
                json=draw_options,
                timeout=120,
                headers=headers,
            )
            if response.status_code != 200:
                return self.create_text_message("Failed to generate image")

            image = response.json()["images"][0]

            return self.create_blob_message(
                blob=b64decode(image),
                meta={"mime_type": "image/png"},
                save_as=self.VariableKey.IMAGE.value,
            )

        except Exception as e:
            return self.create_text_message("Failed to generate image")

    def text2img(
        self, base_url: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        generate image
        """
        # copy draw options
        draw_options = deepcopy(DRAW_TEXT_OPTIONS)
        draw_options.update(tool_parameters)
        # get prompt lora model
        prompt = tool_parameters.get("prompt", "")
        lora = tool_parameters.get("lora", "")
        model = tool_parameters.get("model", "")
        if lora:
            draw_options["prompt"] = f"{lora},{prompt}"
        else:
            draw_options["prompt"] = prompt
        draw_options["override_settings"]["sd_model_checkpoint"] = model
        api_key = self.runtime.credentials.get("api_key") or "abc"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            url = str(URL(base_url) / "sdapi" / "v1" / "txt2img")
            response = post(
                url,
                json=draw_options,
                timeout=120,
                headers=headers,
            )
            if response.status_code != 200:
                return self.create_text_message("Failed to generate image")

            image = response.json()["images"][0]

            return self.create_blob_message(
                blob=b64decode(image),
                meta={"mime_type": "image/png"},
                save_as=self.VariableKey.IMAGE.value,
            )

        except Exception as e:
            return self.create_text_message("Failed to generate image")

    def get_runtime_parameters(self) -> list[ToolParameter]:
        parameters = [
            ToolParameter(
                name="prompt",
                label=I18nObject(en_US="Prompt", zh_Hans="Prompt"),
                human_description=I18nObject(
                    en_US="Image prompt, you can check the official documentation of Stable Diffusion",
                    zh_Hans="图像提示词，您可以查看 Stable Diffusion 的官方文档",
                ),
                type=ToolParameter.ToolParameterType.STRING,
                form=ToolParameter.ToolParameterForm.LLM,
                llm_description="Image prompt of Stable Diffusion, you should describe the image you want to generate"
                " as a list of words as possible as detailed, the prompt must be written in English.",
                required=True,
            ),
        ]
        if len(self.list_default_image_variables()) != 0:
            parameters.append(
                ToolParameter(
                    name="image_id",
                    label=I18nObject(en_US="image_id", zh_Hans="image_id"),
                    human_description=I18nObject(
                        en_US="Image id of the image you want to generate based on, if you want to generate image based"
                        " on the default image, you can leave this field empty.",
                        zh_Hans="您想要生成的图像的图像 ID，如果您想要基于默认图像生成图像，则可以将此字段留空。",
                    ),
                    type=ToolParameter.ToolParameterType.STRING,
                    form=ToolParameter.ToolParameterForm.LLM,
                    llm_description="Image id of the original image, you can leave this field empty if you want to"
                    " generate a new image.",
                    required=True,
                    options=[
                        ToolParameterOption(value=i.name, label=I18nObject(en_US=i.name, zh_Hans=i.name))
                        for i in self.list_default_image_variables()
                    ],
                )
            )

        if self.runtime.credentials:
            try:
                models = self.get_sd_models()
                if len(models) != 0:
                    parameters.append(
                        ToolParameter(
                            name="model",
                            label=I18nObject(en_US="Model", zh_Hans="Model"),
                            human_description=I18nObject(
                                en_US="Model of Stable Diffusion, you can check the official documentation"
                                " of Stable Diffusion",
                                zh_Hans="Stable Diffusion 的模型，您可以查看 Stable Diffusion 的官方文档",
                            ),
                            type=ToolParameter.ToolParameterType.SELECT,
                            form=ToolParameter.ToolParameterForm.FORM,
                            llm_description="Model of Stable Diffusion, you can check the official documentation"
                            " of Stable Diffusion",
                            required=True,
                            default=models[0],
                            options=[
                                ToolParameterOption(value=i, label=I18nObject(en_US=i, zh_Hans=i)) for i in models
                            ],
                        )
                    )

            except:
                pass

            sample_methods = self.get_sample_methods()
            if len(sample_methods) != 0:
                parameters.append(
                    ToolParameter(
                        name="sampler_name",
                        label=I18nObject(en_US="Sampling method", zh_Hans="Sampling method"),
                        human_description=I18nObject(
                            en_US="Sampling method of Stable Diffusion, you can check the official documentation"
                            " of Stable Diffusion",
                            zh_Hans="Stable Diffusion 的Sampling method，您可以查看 Stable Diffusion 的官方文档",
                        ),
                        type=ToolParameter.ToolParameterType.SELECT,
                        form=ToolParameter.ToolParameterForm.FORM,
                        llm_description="Sampling method of Stable Diffusion, you can check the official documentation"
                        " of Stable Diffusion",
                        required=True,
                        default=sample_methods[0],
                        options=[
                            ToolParameterOption(value=i, label=I18nObject(en_US=i, zh_Hans=i)) for i in sample_methods
                        ],
                    )
                )
        return parameters
