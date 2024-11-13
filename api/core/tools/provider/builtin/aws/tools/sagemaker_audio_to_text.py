import json
from typing import Any, Union
import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class WhisperTranscriptionTool(BuiltinTool):
    sagemaker_client: Any = None
    sagemaker_endpoint: str = None

    def _invoke_sagemaker(self, audio_data: bytes, endpoint: str):
        try:
            response = self.sagemaker_client.invoke_endpoint(
                EndpointName=endpoint,
                ContentType='audio/x-audio',
                Body=audio_data
            )
            # 解析响应
            response_body = response['Body'].read().decode('utf8')
            return response_body
        except Exception as e:
            raise Exception(f"转录失败: {str(e)}")

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            # 初始化 SageMaker 客户端
            if not self.sagemaker_client:
                aws_region = tool_parameters.get('aws_region')
                if aws_region:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")

            if not self.sagemaker_endpoint:
                self.sagemaker_endpoint = tool_parameters.get('sagemaker_endpoint')

            # 获取音频文件路径
            audio_file_path = tool_parameters.get('audio_file')

            # 读取音频文件
            with open(audio_file_path, 'rb') as f:
                audio_data = f.read()

            # 调用 SageMaker 端点
            result = self._invoke_sagemaker(audio_data, self.sagemaker_endpoint)

            return self.create_text_message(text=result)

        except Exception as e:
            return self.create_text_message(f'Exception {str(e)}')