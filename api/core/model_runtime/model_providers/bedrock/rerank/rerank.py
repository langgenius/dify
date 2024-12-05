from typing import Optional

import boto3
from botocore.config import Config

from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.rerank_model import RerankModel


class BedrockRerankModel(RerankModel):
    """
    Model class for Cohere rerank model.
    """

    def _invoke(
        self,
        model: str,
        credentials: dict,
        query: str,
        docs: list[str],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
        user: Optional[str] = None,
    ) -> RerankResult:
        """
        Invoke rerank model

        :param model: model name
        :param credentials: model credentials
        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id
        :return: rerank result
        """

        if len(docs) == 0:
            return RerankResult(model=model, docs=docs)

        # initialize client
        client_config = Config(region_name=credentials["aws_region"])
        bedrock_runtime = boto3.client(
            service_name="bedrock-agent-runtime",
            config=client_config,
            aws_access_key_id=credentials.get("aws_access_key_id", ""),
            aws_secret_access_key=credentials.get("aws_secret_access_key"),
        )
        queries = [{"type": "TEXT", "textQuery": {"text": query}}]
        text_sources = []
        for text in docs:
            text_sources.append(
                {
                    "type": "INLINE",
                    "inlineDocumentSource": {
                        "type": "TEXT",
                        "textDocument": {
                            "text": text,
                        },
                    },
                }
            )
        modelId = model
        region = credentials["aws_region"]
        model_package_arn = f"arn:aws:bedrock:{region}::foundation-model/{modelId}"
        rerankingConfiguration = {
            "type": "BEDROCK_RERANKING_MODEL",
            "bedrockRerankingConfiguration": {
                "numberOfResults": top_n,
                "modelConfiguration": {
                    "modelArn": model_package_arn,
                },
            },
        }
        response = bedrock_runtime.rerank(
            queries=queries, sources=text_sources, rerankingConfiguration=rerankingConfiguration
        )

        rerank_documents = []
        for idx, result in enumerate(response["results"]):
            # format document
            index = result["index"]
            rerank_document = RerankDocument(
                index=index,
                text=docs[index],
                score=result["relevanceScore"],
            )

            # score threshold check
            if score_threshold is not None:
                if rerank_document.score >= score_threshold:
                    rerank_documents.append(rerank_document)
            else:
                rerank_documents.append(rerank_document)

        return RerankResult(model=model, docs=rerank_documents)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self.invoke(
                model=model,
                credentials=credentials,
                query="What is the capital of the United States?",
                docs=[
                    "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                    "Census, Carson City had a population of 55,274.",
                    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                    "are a political division controlled by the United States. Its capital is Saipan.",
                ],
                score_threshold=0.8,
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the ermd = genai.GenerativeModel(model) error type thrown to the caller
        The value is the md = genai.GenerativeModel(model) error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke emd = genai.GenerativeModel(model) error mapping
        """
        return {
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: [],
        }
