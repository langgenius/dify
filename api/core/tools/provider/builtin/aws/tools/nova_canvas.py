import base64
import json
import logging
import re
from datetime import datetime
from typing import Any, Union
from urllib.parse import urlparse

import boto3

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.tool.builtin_tool import BuiltinTool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class NovaCanvasTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke AWS Bedrock Nova Canvas model for image generation
        """
        # Get common parameters
        prompt = tool_parameters.get("prompt", "")
        image_output_s3uri = tool_parameters.get("image_output_s3uri", "").strip()
        if not prompt:
            return self.create_text_message("Please provide a text prompt for image generation.")
        if not image_output_s3uri or urlparse(image_output_s3uri).scheme != "s3":
            return self.create_text_message("Please provide an valid S3 URI for image output.")

        task_type = tool_parameters.get("task_type", "TEXT_IMAGE")
        aws_region = tool_parameters.get("aws_region", "us-east-1")

        # Get common image generation config parameters
        width = tool_parameters.get("width", 1024)
        height = tool_parameters.get("height", 1024)
        cfg_scale = tool_parameters.get("cfg_scale", 8.0)
        negative_prompt = tool_parameters.get("negative_prompt", "")
        seed = tool_parameters.get("seed", 0)
        quality = tool_parameters.get("quality", "standard")

        # Handle S3 image if provided
        image_input_s3uri = tool_parameters.get("image_input_s3uri", "")
        if task_type != "TEXT_IMAGE":
            if not image_input_s3uri or urlparse(image_input_s3uri).scheme != "s3":
                return self.create_text_message("Please provide a valid S3 URI for image to image generation.")

            # Parse S3 URI
            parsed_uri = urlparse(image_input_s3uri)
            bucket = parsed_uri.netloc
            key = parsed_uri.path.lstrip("/")

            # Initialize S3 client and download image
            s3_client = boto3.client("s3")
            response = s3_client.get_object(Bucket=bucket, Key=key)
            image_data = response["Body"].read()

            # Base64 encode the image
            input_image = base64.b64encode(image_data).decode("utf-8")

        try:
            # Initialize Bedrock client
            bedrock = boto3.client(service_name="bedrock-runtime", region_name=aws_region)

            # Base image generation config
            image_generation_config = {
                "width": width,
                "height": height,
                "cfgScale": cfg_scale,
                "seed": seed,
                "numberOfImages": 1,
                "quality": quality,
            }

            # Prepare request body based on task type
            body = {"imageGenerationConfig": image_generation_config}

            if task_type == "TEXT_IMAGE":
                body["taskType"] = "TEXT_IMAGE"
                body["textToImageParams"] = {"text": prompt}
                if negative_prompt:
                    body["textToImageParams"]["negativeText"] = negative_prompt

            elif task_type == "COLOR_GUIDED_GENERATION":
                colors = tool_parameters.get("colors", "#ff8080-#ffb280-#ffe680-#ffe680")
                if not self._validate_color_string(colors):
                    return self.create_text_message("Please provide valid colors in hexadecimal format.")

                body["taskType"] = "COLOR_GUIDED_GENERATION"
                body["colorGuidedGenerationParams"] = {
                    "colors": colors.split("-"),
                    "referenceImage": input_image,
                    "text": prompt,
                }
                if negative_prompt:
                    body["colorGuidedGenerationParams"]["negativeText"] = negative_prompt

            elif task_type == "IMAGE_VARIATION":
                similarity_strength = tool_parameters.get("similarity_strength", 0.5)

                body["taskType"] = "IMAGE_VARIATION"
                body["imageVariationParams"] = {
                    "images": [input_image],
                    "similarityStrength": similarity_strength,
                    "text": prompt,
                }
                if negative_prompt:
                    body["imageVariationParams"]["negativeText"] = negative_prompt

            elif task_type == "INPAINTING":
                mask_prompt = tool_parameters.get("mask_prompt")
                if not mask_prompt:
                    return self.create_text_message("Please provide a mask prompt for image inpainting.")

                body["taskType"] = "INPAINTING"
                body["inPaintingParams"] = {"image": input_image, "maskPrompt": mask_prompt, "text": prompt}
                if negative_prompt:
                    body["inPaintingParams"]["negativeText"] = negative_prompt

            elif task_type == "OUTPAINTING":
                mask_prompt = tool_parameters.get("mask_prompt")
                if not mask_prompt:
                    return self.create_text_message("Please provide a mask prompt for image outpainting.")
                outpainting_mode = tool_parameters.get("outpainting_mode", "DEFAULT")

                body["taskType"] = "OUTPAINTING"
                body["outPaintingParams"] = {
                    "image": input_image,
                    "maskPrompt": mask_prompt,
                    "outPaintingMode": outpainting_mode,
                    "text": prompt,
                }
                if negative_prompt:
                    body["outPaintingParams"]["negativeText"] = negative_prompt

            elif task_type == "BACKGROUND_REMOVAL":
                body["taskType"] = "BACKGROUND_REMOVAL"
                body["backgroundRemovalParams"] = {"image": input_image}

            else:
                return self.create_text_message(f"Unsupported task type: {task_type}")

            # Call Nova Canvas model
            response = bedrock.invoke_model(
                body=json.dumps(body),
                modelId="amazon.nova-canvas-v1:0",
                accept="application/json",
                contentType="application/json",
            )

            # Process response
            response_body = json.loads(response.get("body").read())
            if response_body.get("error"):
                raise Exception(f"Error in model response: {response_body.get('error')}")
            base64_image = response_body.get("images")[0]

            # Upload to S3 if image_output_s3uri is provided
            try:
                # Parse S3 URI for output
                parsed_uri = urlparse(image_output_s3uri)
                output_bucket = parsed_uri.netloc
                output_base_path = parsed_uri.path.lstrip("/")
                # Generate filename with timestamp
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_key = f"{output_base_path}/canvas-output-{timestamp}.png"

                # Initialize S3 client if not already done
                s3_client = boto3.client("s3", region_name=aws_region)

                # Decode base64 image and upload to S3
                image_data = base64.b64decode(base64_image)
                s3_client.put_object(Bucket=output_bucket, Key=output_key, Body=image_data, ContentType="image/png")
                logger.info(f"Image uploaded to s3://{output_bucket}/{output_key}")
            except Exception as e:
                logger.exception("Failed to upload image to S3")
            # Return image
            return [
                self.create_text_message(f"Image is available at: s3://{output_bucket}/{output_key}"),
                self.create_blob_message(
                    blob=base64.b64decode(base64_image),
                    meta={"mime_type": "image/png"},
                    save_as=self.VariableKey.IMAGE.value,
                ),
            ]

        except Exception as e:
            return self.create_text_message(f"Failed to generate image: {str(e)}")

    def _validate_color_string(self, color_string) -> bool:
        color_pattern = r"^#[0-9a-fA-F]{6}(?:-#[0-9a-fA-F]{6})*$"

        if re.match(color_pattern, color_string):
            return True
        return False

    def get_runtime_parameters(self) -> list[ToolParameter]:
        parameters = [
            ToolParameter(
                name="prompt",
                label=I18nObject(en_US="Prompt", zh_Hans="提示词"),
                type=ToolParameter.ToolParameterType.STRING,
                required=True,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="Text description of the image you want to generate or modify",
                    zh_Hans="您想要生成或修改的图像的文本描述",
                ),
                llm_description="Describe the image you want to generate or how you want to modify the input image",
            ),
            ToolParameter(
                name="image_input_s3uri",
                label=I18nObject(en_US="Input image s3 uri", zh_Hans="输入图片的s3 uri"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(en_US="Image to be modified", zh_Hans="想要修改的图片"),
            ),
            ToolParameter(
                name="image_output_s3uri",
                label=I18nObject(en_US="Output Image S3 URI", zh_Hans="输出图片的S3 URI目录"),
                type=ToolParameter.ToolParameterType.STRING,
                required=True,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="S3 URI where the generated image should be uploaded", zh_Hans="生成的图像应该上传到的S3 URI"
                ),
            ),
            ToolParameter(
                name="width",
                label=I18nObject(en_US="Width", zh_Hans="宽度"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=1024,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Width of the generated image", zh_Hans="生成图像的宽度"),
            ),
            ToolParameter(
                name="height",
                label=I18nObject(en_US="Height", zh_Hans="高度"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=1024,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Height of the generated image", zh_Hans="生成图像的高度"),
            ),
            ToolParameter(
                name="cfg_scale",
                label=I18nObject(en_US="CFG Scale", zh_Hans="CFG比例"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=8.0,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="How strongly the image should conform to the prompt", zh_Hans="图像应该多大程度上符合提示词"
                ),
            ),
            ToolParameter(
                name="negative_prompt",
                label=I18nObject(en_US="Negative Prompt", zh_Hans="负面提示词"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default="",
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="Things you don't want in the generated image", zh_Hans="您不想在生成的图像中出现的内容"
                ),
            ),
            ToolParameter(
                name="seed",
                label=I18nObject(en_US="Seed", zh_Hans="种子值"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=0,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Random seed for image generation", zh_Hans="图像生成的随机种子"),
            ),
            ToolParameter(
                name="aws_region",
                label=I18nObject(en_US="AWS Region", zh_Hans="AWS 区域"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default="us-east-1",
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="AWS region for Bedrock service", zh_Hans="Bedrock 服务的 AWS 区域"),
            ),
            ToolParameter(
                name="task_type",
                label=I18nObject(en_US="Task Type", zh_Hans="任务类型"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default="TEXT_IMAGE",
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(en_US="Type of image generation task", zh_Hans="图像生成任务的类型"),
            ),
            ToolParameter(
                name="quality",
                label=I18nObject(en_US="Quality", zh_Hans="质量"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default="standard",
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="Quality of the generated image (standard or premium)", zh_Hans="生成图像的质量（标准或高级）"
                ),
            ),
            ToolParameter(
                name="colors",
                label=I18nObject(en_US="Colors", zh_Hans="颜色"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="List of colors for color-guided generation, example: #ff8080-#ffb280-#ffe680-#ffe680",
                    zh_Hans="颜色引导生成的颜色列表, 例子: #ff8080-#ffb280-#ffe680-#ffe680",
                ),
            ),
            ToolParameter(
                name="similarity_strength",
                label=I18nObject(en_US="Similarity Strength", zh_Hans="相似度强度"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=0.5,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="How similar the generated image should be to the input image (0.0 to 1.0)",
                    zh_Hans="生成的图像应该与输入图像的相似程度（0.0到1.0）",
                ),
            ),
            ToolParameter(
                name="mask_prompt",
                label=I18nObject(en_US="Mask Prompt", zh_Hans="蒙版提示词"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="Text description to generate mask for inpainting/outpainting",
                    zh_Hans="用于生成内补绘制/外补绘制蒙版的文本描述",
                ),
            ),
            ToolParameter(
                name="outpainting_mode",
                label=I18nObject(en_US="Outpainting Mode", zh_Hans="外补绘制模式"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default="DEFAULT",
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="Mode for outpainting (DEFAULT or other supported modes)",
                    zh_Hans="外补绘制的模式（DEFAULT或其他支持的模式）",
                ),
            ),
        ]

        return parameters
