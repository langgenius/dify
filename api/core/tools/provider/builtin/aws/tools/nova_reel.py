import base64
import logging
import time
from io import BytesIO
from typing import Any, Optional, Union
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError
from PIL import Image

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.tool.builtin_tool import BuiltinTool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NOVA_REEL_DEFAULT_REGION = "us-east-1"
NOVA_REEL_DEFAULT_DIMENSION = "1280x720"
NOVA_REEL_DEFAULT_FPS = 24
NOVA_REEL_DEFAULT_DURATION = 6
NOVA_REEL_MODEL_ID = "amazon.nova-reel-v1:0"
NOVA_REEL_STATUS_CHECK_INTERVAL = 5

# Image requirements
NOVA_REEL_REQUIRED_IMAGE_WIDTH = 1280
NOVA_REEL_REQUIRED_IMAGE_HEIGHT = 720
NOVA_REEL_REQUIRED_IMAGE_MODE = "RGB"


class NovaReelTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke AWS Bedrock Nova Reel model for video generation.

        Args:
            user_id: The ID of the user making the request
            tool_parameters: Dictionary containing the tool parameters

        Returns:
            ToolInvokeMessage containing either the video content or status information
        """
        try:
            # Validate and extract parameters
            params = self._validate_and_extract_parameters(tool_parameters)
            if isinstance(params, ToolInvokeMessage):
                return params

            # Initialize AWS clients
            bedrock, s3_client = self._initialize_aws_clients(params["aws_region"])

            # Prepare model input
            model_input = self._prepare_model_input(params, s3_client)
            if isinstance(model_input, ToolInvokeMessage):
                return model_input

            # Start video generation
            invocation = self._start_video_generation(bedrock, model_input, params["video_output_s3uri"])
            invocation_arn = invocation["invocationArn"]

            # Handle async/sync mode
            return self._handle_generation_mode(bedrock, s3_client, invocation_arn, params["async_mode"])

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            error_message = e.response.get("Error", {}).get("Message", str(e))
            logger.exception(f"AWS API error: {error_code} - {error_message}")
            return self.create_text_message(f"AWS service error: {error_code} - {error_message}")
        except Exception as e:
            logger.error(f"Unexpected error in video generation: {str(e)}", exc_info=True)
            return self.create_text_message(f"Failed to generate video: {str(e)}")

    def _validate_and_extract_parameters(
        self, tool_parameters: dict[str, Any]
    ) -> Union[dict[str, Any], ToolInvokeMessage]:
        """Validate and extract parameters from the input dictionary."""
        prompt = tool_parameters.get("prompt", "")
        video_output_s3uri = tool_parameters.get("video_output_s3uri", "").strip()

        # Validate required parameters
        if not prompt:
            return self.create_text_message("Please provide a text prompt for video generation.")
        if not video_output_s3uri:
            return self.create_text_message("Please provide an S3 URI for video output.")

        # Validate S3 URI format
        if not video_output_s3uri.startswith("s3://"):
            return self.create_text_message("Invalid S3 URI format. Must start with 's3://'")

        # Ensure S3 URI ends with '/'
        video_output_s3uri = video_output_s3uri if video_output_s3uri.endswith("/") else video_output_s3uri + "/"

        return {
            "prompt": prompt,
            "video_output_s3uri": video_output_s3uri,
            "image_input_s3uri": tool_parameters.get("image_input_s3uri", "").strip(),
            "aws_region": tool_parameters.get("aws_region", NOVA_REEL_DEFAULT_REGION),
            "dimension": tool_parameters.get("dimension", NOVA_REEL_DEFAULT_DIMENSION),
            "seed": int(tool_parameters.get("seed", 0)),
            "fps": int(tool_parameters.get("fps", NOVA_REEL_DEFAULT_FPS)),
            "duration": int(tool_parameters.get("duration", NOVA_REEL_DEFAULT_DURATION)),
            "async_mode": bool(tool_parameters.get("async", True)),
        }

    def _initialize_aws_clients(self, region: str) -> tuple[Any, Any]:
        """Initialize AWS Bedrock and S3 clients."""
        bedrock = boto3.client(service_name="bedrock-runtime", region_name=region)
        s3_client = boto3.client("s3", region_name=region)
        return bedrock, s3_client

    def _prepare_model_input(self, params: dict[str, Any], s3_client: Any) -> Union[dict[str, Any], ToolInvokeMessage]:
        """Prepare the input for the Nova Reel model."""
        model_input = {
            "taskType": "TEXT_VIDEO",
            "textToVideoParams": {"text": params["prompt"]},
            "videoGenerationConfig": {
                "durationSeconds": params["duration"],
                "fps": params["fps"],
                "dimension": params["dimension"],
                "seed": params["seed"],
            },
        }

        # Add image if provided
        if params["image_input_s3uri"]:
            try:
                image_data = self._get_image_from_s3(s3_client, params["image_input_s3uri"])
                if not image_data:
                    return self.create_text_message("Failed to retrieve image from S3")

                # Process and validate image
                processed_image = self._process_and_validate_image(image_data)
                if isinstance(processed_image, ToolInvokeMessage):
                    return processed_image

                # Convert processed image to base64
                img_buffer = BytesIO()
                processed_image.save(img_buffer, format="PNG")
                img_buffer.seek(0)
                input_image_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")

                model_input["textToVideoParams"]["images"] = [
                    {"format": "png", "source": {"bytes": input_image_base64}}
                ]
            except Exception as e:
                logger.error(f"Error processing input image: {str(e)}", exc_info=True)
                return self.create_text_message(f"Failed to process input image: {str(e)}")

        return model_input

    def _process_and_validate_image(self, image_data: bytes) -> Union[Image.Image, ToolInvokeMessage]:
        """
        Process and validate the input image according to Nova Reel requirements.

        Requirements:
        - Must be 1280x720 pixels
        - Must be RGB format (8 bits per channel)
        - If PNG, alpha channel must not have transparent/translucent pixels
        """
        try:
            # Open image
            img = Image.open(BytesIO(image_data))

            # Convert RGBA to RGB if needed, ensuring no transparency
            if img.mode == "RGBA":
                # Check for transparency
                if img.getchannel("A").getextrema()[0] < 255:
                    return self.create_text_message(
                        "PNG image contains transparent or translucent pixels, which is not supported. "
                        "Please provide an image without transparency."
                    )
                # Convert to RGB
                img = img.convert("RGB")
            elif img.mode != "RGB":
                # Convert any other mode to RGB
                img = img.convert("RGB")

            # Validate/adjust dimensions
            if img.size != (NOVA_REEL_REQUIRED_IMAGE_WIDTH, NOVA_REEL_REQUIRED_IMAGE_HEIGHT):
                logger.warning(
                    f"Image dimensions {img.size} do not match required dimensions "
                    f"({NOVA_REEL_REQUIRED_IMAGE_WIDTH}x{NOVA_REEL_REQUIRED_IMAGE_HEIGHT}). Resizing..."
                )
                img = img.resize(
                    (NOVA_REEL_REQUIRED_IMAGE_WIDTH, NOVA_REEL_REQUIRED_IMAGE_HEIGHT), Image.Resampling.LANCZOS
                )

            # Validate bit depth
            if img.mode != NOVA_REEL_REQUIRED_IMAGE_MODE:
                return self.create_text_message(
                    f"Image must be in {NOVA_REEL_REQUIRED_IMAGE_MODE} mode with 8 bits per channel"
                )

            return img

        except Exception as e:
            logger.error(f"Error processing image: {str(e)}", exc_info=True)
            return self.create_text_message(
                "Failed to process image. Please ensure the image is a valid JPEG or PNG file."
            )

    def _get_image_from_s3(self, s3_client: Any, s3_uri: str) -> Optional[bytes]:
        """Download and return image data from S3."""
        parsed_uri = urlparse(s3_uri)
        bucket = parsed_uri.netloc
        key = parsed_uri.path.lstrip("/")

        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def _start_video_generation(self, bedrock: Any, model_input: dict[str, Any], output_s3uri: str) -> dict[str, Any]:
        """Start the async video generation process."""
        return bedrock.start_async_invoke(
            modelId=NOVA_REEL_MODEL_ID,
            modelInput=model_input,
            outputDataConfig={"s3OutputDataConfig": {"s3Uri": output_s3uri}},
        )

    def _handle_generation_mode(
        self, bedrock: Any, s3_client: Any, invocation_arn: str, async_mode: bool
    ) -> ToolInvokeMessage:
        """Handle async or sync video generation mode."""
        invocation_response = bedrock.get_async_invoke(invocationArn=invocation_arn)
        video_path = invocation_response["outputDataConfig"]["s3OutputDataConfig"]["s3Uri"]
        video_uri = f"{video_path}/output.mp4"

        if async_mode:
            return self.create_text_message(
                f"Video generation started.\nInvocation ARN: {invocation_arn}\n"
                f"Video will be available at: {video_uri}"
            )

        return self._wait_for_completion(bedrock, s3_client, invocation_arn)

    def _wait_for_completion(self, bedrock: Any, s3_client: Any, invocation_arn: str) -> ToolInvokeMessage:
        """Wait for video generation completion and handle the result."""
        while True:
            status_response = bedrock.get_async_invoke(invocationArn=invocation_arn)
            status = status_response["status"]
            video_path = status_response["outputDataConfig"]["s3OutputDataConfig"]["s3Uri"]

            if status == "Completed":
                return self._handle_completed_video(s3_client, video_path)
            elif status == "Failed":
                failure_message = status_response.get("failureMessage", "Unknown error")
                return self.create_text_message(f"Video generation failed.\nError: {failure_message}")
            elif status == "InProgress":
                time.sleep(NOVA_REEL_STATUS_CHECK_INTERVAL)
            else:
                return self.create_text_message(f"Unexpected status: {status}")

    def _handle_completed_video(self, s3_client: Any, video_path: str) -> ToolInvokeMessage:
        """Handle completed video generation and return the result."""
        parsed_uri = urlparse(video_path)
        bucket = parsed_uri.netloc
        key = parsed_uri.path.lstrip("/") + "/output.mp4"

        try:
            response = s3_client.get_object(Bucket=bucket, Key=key)
            video_content = response["Body"].read()
            return [
                self.create_text_message(f"Video is available at: {video_path}/output.mp4"),
                self.create_blob_message(blob=video_content, meta={"mime_type": "video/mp4"}, save_as="output.mp4"),
            ]
        except Exception as e:
            logger.error(f"Error downloading video: {str(e)}", exc_info=True)
            return self.create_text_message(
                f"Video generation completed but failed to download video: {str(e)}\n"
                f"Video is available at: s3://{bucket}/{key}"
            )

    def get_runtime_parameters(self) -> list[ToolParameter]:
        """Define the tool's runtime parameters."""
        parameters = [
            ToolParameter(
                name="prompt",
                label=I18nObject(en_US="Prompt", zh_Hans="提示词"),
                type=ToolParameter.ToolParameterType.STRING,
                required=True,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="Text description of the video you want to generate", zh_Hans="您想要生成的视频的文本描述"
                ),
                llm_description="Describe the video you want to generate",
            ),
            ToolParameter(
                name="video_output_s3uri",
                label=I18nObject(en_US="Output S3 URI", zh_Hans="输出S3 URI"),
                type=ToolParameter.ToolParameterType.STRING,
                required=True,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="S3 URI where the generated video will be stored", zh_Hans="生成的视频将存储的S3 URI"
                ),
            ),
            ToolParameter(
                name="dimension",
                label=I18nObject(en_US="Dimension", zh_Hans="尺寸"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default=NOVA_REEL_DEFAULT_DIMENSION,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Video dimensions (width x height)", zh_Hans="视频尺寸（宽 x 高）"),
            ),
            ToolParameter(
                name="duration",
                label=I18nObject(en_US="Duration", zh_Hans="时长"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=NOVA_REEL_DEFAULT_DURATION,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Video duration in seconds", zh_Hans="视频时长（秒）"),
            ),
            ToolParameter(
                name="seed",
                label=I18nObject(en_US="Seed", zh_Hans="种子值"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=0,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="Random seed for video generation", zh_Hans="视频生成的随机种子"),
            ),
            ToolParameter(
                name="fps",
                label=I18nObject(en_US="FPS", zh_Hans="帧率"),
                type=ToolParameter.ToolParameterType.NUMBER,
                required=False,
                default=NOVA_REEL_DEFAULT_FPS,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(
                    en_US="Frames per second for the generated video", zh_Hans="生成视频的每秒帧数"
                ),
            ),
            ToolParameter(
                name="async",
                label=I18nObject(en_US="Async Mode", zh_Hans="异步模式"),
                type=ToolParameter.ToolParameterType.BOOLEAN,
                required=False,
                default=True,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="Whether to run in async mode (return immediately) or sync mode (wait for completion)",
                    zh_Hans="是否以异步模式运行（立即返回）或同步模式（等待完成）",
                ),
            ),
            ToolParameter(
                name="aws_region",
                label=I18nObject(en_US="AWS Region", zh_Hans="AWS 区域"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                default=NOVA_REEL_DEFAULT_REGION,
                form=ToolParameter.ToolParameterForm.FORM,
                human_description=I18nObject(en_US="AWS region for Bedrock service", zh_Hans="Bedrock 服务的 AWS 区域"),
            ),
            ToolParameter(
                name="image_input_s3uri",
                label=I18nObject(en_US="Input Image S3 URI", zh_Hans="输入图像S3 URI"),
                type=ToolParameter.ToolParameterType.STRING,
                required=False,
                form=ToolParameter.ToolParameterForm.LLM,
                human_description=I18nObject(
                    en_US="S3 URI of the input image (1280x720 JPEG/PNG) to use as first frame",
                    zh_Hans="用作第一帧的输入图像（1280x720 JPEG/PNG）的S3 URI",
                ),
            ),
        ]

        return parameters
