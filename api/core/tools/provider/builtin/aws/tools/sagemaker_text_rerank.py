import json
from typing import Any, Union

import boto3

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SageMakerReRankTool(BuiltinTool):
    sagemaker_client: Any = None
    sagemaker_endpoint:str = None
    topk:int = None

    def _sagemaker_rerank(self, query_input: str, docs: list[str], rerank_endpoint:str):
        inputs = [query_input]*len(docs)
        response_model = self.sagemaker_client.invoke_endpoint(
            EndpointName=rerank_endpoint,
            Body=json.dumps(
                {
                    "inputs": inputs,
                    "docs": docs
                }
            ),
            ContentType="application/json",
        )
        json_str = response_model['Body'].read().decode('utf8')
        json_obj = json.loads(json_str)
        scores = json_obj['scores']
        return scores if isinstance(scores, list) else [scores]

    def _invoke(self, 
                user_id: str, 
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        line = 0
        try:
            if not self.sagemaker_client:
                aws_region = tool_parameters.get('aws_region')
                if aws_region:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")

            line = 1
            if not self.sagemaker_endpoint:
                self.sagemaker_endpoint = tool_parameters.get('sagemaker_endpoint')

            line = 2
            if not self.topk:
                self.topk = tool_parameters.get('topk', 5)

            line = 3
            query = tool_parameters.get('query', '')
            if not query:
                return self.create_text_message('Please input query')
            
            line = 4
            candidate_texts = tool_parameters.get('candidate_texts')
            if not candidate_texts:
                return self.create_text_message('Please input candidate_texts')
            
            line = 5
            candidate_docs = json.loads(candidate_texts)
            docs = [ item.get('content') for item in candidate_docs ]

            line = 6
            scores = self._sagemaker_rerank(query_input=query, docs=docs, rerank_endpoint=self.sagemaker_endpoint)

            line = 7
            for idx in range(len(candidate_docs)):
                candidate_docs[idx]["score"] = scores[idx]

            line = 8
            sorted_candidate_docs = sorted(candidate_docs, key=lambda x: x['score'], reverse=True)

            line = 9
            results_str = json.dumps(sorted_candidate_docs[:self.topk], ensure_ascii=False)
            return self.create_text_message(text=results_str)
            
        except Exception as e:
            return self.create_text_message(f'Exception {str(e)}, line : {line}')
    