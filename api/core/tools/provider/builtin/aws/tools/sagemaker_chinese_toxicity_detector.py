import json
from typing import Any, Union

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ContentModerationTool(BuiltinTool):
    sagemaker_client: Any = None
    sagemaker_endpoint: str = None

    def _invoke_sagemaker(self, payload: dict, endpoint: str):
        response_model = self.sagemaker_client.invoke_endpoint(
            EndpointName=endpoint,
            Body=json.dumps(payload),
            ContentType="application/json",
        )
        json_str = response_model['Body'].read().decode('utf8')
        json_obj = json.loads(json_str)
        return json_obj

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            if not self.sagemaker_client:
                aws_region = tool_parameters.get('aws_region')
                if aws_region:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")

            if not self.sagemaker_endpoint:
                self.sagemaker_endpoint = tool_parameters.get('sagemaker_endpoint')

            content_text = tool_parameters.get('content_text')

            payload = {
                "text": content_text
            }

            result = self._invoke_sagemaker(payload, self.sagemaker_endpoint)

            return self.create_text_message(text=result['result'])

        except Exception as e:
            return self.create_text_message(f'Exception {str(e)}')