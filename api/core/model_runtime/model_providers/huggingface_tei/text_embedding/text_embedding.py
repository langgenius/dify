import time
from typing import Optional

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType, PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.huggingface_tei.tei_helper import TeiHelper


class HuggingfaceTeiTextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for Text Embedding Inference text embedding model.
    """

    def _invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
        user: Optional[str] = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> TextEmbeddingResult:
        """
        Invoke text embedding model

        credentials should be like:
        {
            'server_url': 'server url',
            'model_uid': 'model uid',
        }

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :param input_type: input type
        :return: embeddings result
        """
        server_url = credentials["server_url"]

        server_url = server_url.removesuffix("/")

        # get model properties
        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)

        inputs = []
        indices = []
        used_tokens = 0

        # get tokenized results from TEI
        batched_tokenize_result = TeiHelper.invoke_tokenize(server_url, texts)

        for i, (text, tokenize_result) in enumerate(zip(texts, batched_tokenize_result)):
            # Check if the number of tokens is larger than the context size
            num_tokens = len(tokenize_result)

            if num_tokens >= context_size:
                # Find the best cutoff point
                pre_special_token_count = 0
                for token in tokenize_result:
                    if token["special"]:
                        pre_special_token_count += 1
                    else:
                        break
                rest_special_token_count = (
                    len([token for token in tokenize_result if token["special"]]) - pre_special_token_count
                )

                # Calculate the cutoff point, leave 20 extra space to avoid exceeding the limit
                token_cutoff = context_size - rest_special_token_count - 20

                # Find the cutoff index
                cutpoint_token = tokenize_result[token_cutoff]
                cutoff = cutpoint_token["start"]

                inputs.append(text[0:cutoff])
            else:
                inputs.append(text)
            indices += [i]

        batched_embeddings = []
        _iter = range(0, len(inputs), max_chunks)

        try:
            used_tokens = 0
            for i in _iter:
                iter_texts = inputs[i : i + max_chunks]
                results = TeiHelper.invoke_embeddings(server_url, iter_texts)
                embeddings = results["data"]
                embeddings = [embedding["embedding"] for embedding in embeddings]
                batched_embeddings.extend(embeddings)

                usage = results["usage"]
                used_tokens += usage["total_tokens"]
        except RuntimeError as e:
            raise InvokeServerUnavailableError(str(e))

        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=used_tokens)

        result = TextEmbeddingResult(model=model, embeddings=batched_embeddings, usage=usage)

        return result

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        num_tokens = 0
        server_url = credentials["server_url"]

        server_url = server_url.removesuffix("/")

        batch_tokens = TeiHelper.invoke_tokenize(server_url, texts)
        num_tokens = sum(len(tokens) for tokens in batch_tokens)
        return num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            server_url = credentials["server_url"]
            extra_args = TeiHelper.get_tei_extra_parameter(server_url, model)
            print(extra_args)
            if extra_args.model_type != "embedding":
                raise CredentialsValidateFailedError("Current model is not a embedding model")

            credentials["context_size"] = extra_args.max_input_length
            credentials["max_chunks"] = extra_args.max_client_batch_size
            self._invoke(model=model, credentials=credentials, texts=["ping"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [KeyError],
        }

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param tokens: input tokens
        :return: usage
        """
        # get input price info
        input_price_info = self.get_price(
            model=model, credentials=credentials, price_type=PriceType.INPUT, tokens=tokens
        )

        # transform usage
        usage = EmbeddingUsage(
            tokens=tokens,
            total_tokens=tokens,
            unit_price=input_price_info.unit_price,
            price_unit=input_price_info.unit,
            total_price=input_price_info.total_amount,
            currency=input_price_info.currency,
            latency=time.perf_counter() - self.started_at,
        )

        return usage

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        used to define customizable model schema
        """

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                ModelPropertyKey.MAX_CHUNKS: int(credentials.get("max_chunks", 1)),
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get("context_size", 512)),
            },
            parameter_rules=[],
        )

        return entity
