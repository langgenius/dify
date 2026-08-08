import boto3
from pydantic import BaseModel, Field

from configs import dify_config


class BedrockRetrievalSetting(BaseModel):
    """Retrieval settings for Amazon Bedrock knowledge base queries."""

    top_k: int | None = Field(default=None, description="Maximum number of results to retrieve")
    score_threshold: float = Field(default=0.0, description="Minimum relevance score threshold")


class ExternalDatasetTestService:
    # this service is only for internal testing
    @staticmethod
    def knowledge_retrieval(retrieval_setting: BedrockRetrievalSetting, query: str, knowledge_id: str):
        # get bedrock client
        client = boto3.client(
            "bedrock-agent-runtime",
            aws_secret_access_key=dify_config.AWS_SECRET_ACCESS_KEY,
            aws_access_key_id=dify_config.AWS_ACCESS_KEY_ID,
            # example: us-east-1
            region_name="us-east-1",
        )
        # fetch external knowledge retrieval
        response = client.retrieve(
            knowledgeBaseId=knowledge_id,
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": retrieval_setting.top_k,
                    "overrideSearchType": "HYBRID",
                }
            },
            retrievalQuery={"text": query},
        )
        # parse response
        results = []
        if response.get("ResponseMetadata") and response.get("ResponseMetadata").get("HTTPStatusCode") == 200:
            if response.get("retrievalResults"):
                retrieval_results = response.get("retrievalResults")
                for retrieval_result in retrieval_results:
                    score = retrieval_result.get("score") or 0.0
                    if score < retrieval_setting.score_threshold:
                        continue
                    metadata = retrieval_result.get("metadata") or {}
                    content = retrieval_result.get("content") or {}
                    result = {
                        "metadata": metadata,
                        "score": score,
                        "title": metadata.get("x-amz-bedrock-kb-source-uri"),
                        "content": content.get("text"),
                    }
                    results.append(result)
        return {"records": results}
