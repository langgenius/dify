from typing import Optional

from xinference_client.client.restful.restful_client import Client, RESTfulRerankModelHandle

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
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


class XinferenceRerankModel(RerankModel):
    """
    Model class for Xinference rerank model.
    """

    def _invoke(self, model: str, credentials: dict,
                query: str, docs: list[str], score_threshold: Optional[float] = None, top_n: Optional[int] = None,
                user: Optional[str] = None) \
            -> RerankResult:
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
            return RerankResult(
                model=model,
                docs=[]
            )

        server_url = credentials['server_url']
        model_uid = credentials['model_uid']
        api_key = credentials.get('api_key')
        if server_url.endswith('/'):
            server_url = server_url[:-1]
        auth_headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}

        try:
            handle = RESTfulRerankModelHandle(model_uid, server_url, auth_headers)
            response = handle.rerank(
                documents=docs,
                query=query,
                top_n=top_n,
            )
        except RuntimeError as e:
            raise InvokeServerUnavailableError(str(e))


        rerank_documents = []
        for idx, result in enumerate(response['results']):
            # format document
            index = result['index']
            page_content = result['document']
            rerank_document = RerankDocument(
                index=index,
                text=page_content,
                score=result['relevance_score'],
            )

            # score threshold check
            if score_threshold is not None:
                if result['relevance_score'] >= score_threshold:
                    rerank_documents.append(rerank_document)
            else:
                rerank_documents.append(rerank_document)

        return RerankResult(
            model=model,
            docs=rerank_documents
        )

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            if "/" in credentials['model_uid'] or "?" in credentials['model_uid'] or "#" in credentials['model_uid']:
                raise CredentialsValidateFailedError("model_uid should not contain /, ?, or #")

            if credentials['server_url'].endswith('/'):
                credentials['server_url'] = credentials['server_url'][:-1]

            # initialize client
            client = Client(
                base_url=credentials['server_url']
            )

            xinference_client = client.get_model(model_uid=credentials['model_uid'])

            if not isinstance(xinference_client, RESTfulRerankModelHandle):
                raise InvokeBadRequestError(
                    'please check model type, the model you want to invoke is not a rerank model')

            self.invoke(
                model=model,
                credentials=credentials,
                query="Whose kasumi",
                docs=[
                    "Kasumi is a girl's name of Japanese origin meaning \"mist\".",
                    "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music ",
                    "and she leads a team named PopiParty."
                ],
                score_threshold=0.8
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [
                InvokeConnectionError
            ],
            InvokeServerUnavailableError: [
                InvokeServerUnavailableError
            ],
            InvokeRateLimitError: [
                InvokeRateLimitError
            ],
            InvokeAuthorizationError: [
                InvokeAuthorizationError
            ],
            InvokeBadRequestError: [
                InvokeBadRequestError,
                KeyError,
                ValueError
            ]
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.RERANK,
            model_properties={ },
            parameter_rules=[]
        )

        return entity
