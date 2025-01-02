import json
from typing import Any, Union

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

# Define label mappings
LABEL_MAPPING = {0: "SAFE", 1: "NO_SAFE"}


class ContentModerationTool(BuiltinTool):
    sagemaker_client: Any = None
    sagemaker_endpoint: str = None

    def _invoke_sagemaker(self, payload: dict, endpoint: str):
        response = self.sagemaker_client.invoke_endpoint(
            EndpointName=endpoint,
            Body=json.dumps(payload),
            ContentType="application/json",
        )
        # Parse response
        response_body = response["Body"].read().decode("utf8")

        json_obj = json.loads(response_body)

        # Handle nested JSON if present
        if isinstance(json_obj, dict) and "body" in json_obj:
            body_content = json.loads(json_obj["body"])
            prediction_result = body_content.get("prediction")
        else:
            prediction_result = json_obj.get("prediction")

        # Map labels and return
        result = LABEL_MAPPING.get(prediction_result, "NO_SAFE")  # If not found in mapping, default to NO_SAFE
        return result

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            if not self.sagemaker_client:
                aws_region = tool_parameters.get("aws_region")
                if aws_region:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")

            if not self.sagemaker_endpoint:
                self.sagemaker_endpoint = tool_parameters.get("sagemaker_endpoint")

            content_text = tool_parameters.get("content_text")

            payload = {"text": content_text}

            result = self._invoke_sagemaker(payload, self.sagemaker_endpoint)

            return self.create_text_message(text=result)

        except Exception as e:
            return self.create_text_message(f"Exception {str(e)}")
