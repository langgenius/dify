import json
from typing import Any, Union

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class LambdaTranslateUtilsTool(BuiltinTool):
    lambda_client: Any = None

    def _invoke_lambda(self, text_content, src_lang, dest_lang, model_id, dictionary_name, request_type, lambda_name):
        msg = { 
            "src_content":text_content, 
            "src_lang": src_lang, 
            "dest_lang":dest_lang, 
            "dictionary_id": dictionary_name,
            "request_type" : request_type, 
            "model_id" : model_id
        }

        invoke_response = self.lambda_client.invoke(FunctionName=lambda_name,
                                               InvocationType='RequestResponse',
                                               Payload=json.dumps(msg))
        response_body = invoke_response['Payload']

        response_str = response_body.read().decode("unicode_escape")

        return response_str

    def _invoke(self, 
                user_id: str, 
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        line = 0
        try:
            if not self.lambda_client:
                aws_region = tool_parameters.get('aws_region')
                if aws_region:
                    self.lambda_client = boto3.client("lambda", region_name=aws_region)
                else:
                    self.lambda_client = boto3.client("lambda")

            line = 1
            text_content = tool_parameters.get('text_content', '')
            if not text_content:
                return self.create_text_message('Please input text_content')
            
            line = 2
            src_lang = tool_parameters.get('src_lang', '')
            if not src_lang:
                return self.create_text_message('Please input src_lang')
            
            line = 3
            dest_lang = tool_parameters.get('dest_lang', '')
            if not dest_lang:
                return self.create_text_message('Please input dest_lang')
            
            line = 4
            lambda_name = tool_parameters.get('lambda_name', '')
            if not lambda_name:
                return self.create_text_message('Please input lambda_name')
            
            line = 5
            request_type = tool_parameters.get('request_type', '')
            if not request_type:
                return self.create_text_message('Please input request_type')
            
            line = 6
            model_id = tool_parameters.get('model_id', '')
            if not model_id:
                return self.create_text_message('Please input model_id')

            line = 7
            dictionary_name = tool_parameters.get('dictionary_name', '')
            if not dictionary_name:
                return self.create_text_message('Please input dictionary_name')
            
            result = self._invoke_lambda(text_content, src_lang, dest_lang, model_id, dictionary_name, request_type, lambda_name)

            return self.create_text_message(text=result)

        except Exception as e:
            return self.create_text_message(f'Exception {str(e)}, line : {line}')
