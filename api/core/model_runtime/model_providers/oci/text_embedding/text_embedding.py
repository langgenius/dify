import base64
import copy
import time
from typing import Optional

import numpy as np
import oci

from core.embedding.embedding_constant import EmbeddingInputType
from core.model_runtime.entities.model_entities import PriceType
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

request_template = {
    "compartmentId": "",
    "servingMode": {"modelId": "cohere.embed-english-light-v3.0", "servingType": "ON_DEMAND"},
    "truncate": "NONE",
    "inputs": [""],
}
oci_config_template = {
    "user": "",
    "fingerprint": "",
    "tenancy": "",
    "region": "",
    "compartment_id": "",
    "key_content": "",
}


class OCITextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for Cohere text embedding model.
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

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :param input_type: input type
        :return: embeddings result
        """
        # get model properties
        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)

        inputs = []
        indices = []
        used_tokens = 0

        for i, text in enumerate(texts):
            # Here token count is only an approximation based on the GPT2 tokenizer
            num_tokens = self._get_num_tokens_by_gpt2(text)

            if num_tokens >= context_size:
                cutoff = int(len(text) * (np.floor(context_size / num_tokens)))
                # if num tokens is larger than context length, only use the start
                inputs.append(text[0:cutoff])
            else:
                inputs.append(text)
            indices += [i]

        batched_embeddings = []
        _iter = range(0, len(inputs), max_chunks)

        for i in _iter:
            # call embedding model
            embeddings_batch, embedding_used_tokens = self._embedding_invoke(
                model=model, credentials=credentials, texts=inputs[i : i + max_chunks]
            )

            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch

        # calc usage
        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=used_tokens)

        return TextEmbeddingResult(embeddings=batched_embeddings, usage=usage, model=model)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return sum(self._get_num_tokens_by_gpt2(text) for text in texts)

    def get_num_characters(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        characters = 0
        for text in texts:
            characters += len(text)
        return characters

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # call embedding model
            self._embedding_invoke(model=model, credentials=credentials, texts=["ping"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _embedding_invoke(self, model: str, credentials: dict, texts: list[str]) -> tuple[list[list[float]], int]:
        """
        Invoke embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return: embeddings and used tokens
        """

        # oci
        # initialize client
        oci_config = copy.deepcopy(oci_config_template)
        if "oci_config_content" in credentials:
            oci_config_content = base64.b64decode(credentials.get("oci_config_content")).decode("utf-8")
            config_items = oci_config_content.split("/")
            if len(config_items) != 5:
                raise CredentialsValidateFailedError(
                    "oci_config_content should be base64.b64encode("
                    "'user_ocid/fingerprint/tenancy_ocid/region/compartment_ocid'.encode('utf-8'))"
                )
            oci_config["user"] = config_items[0]
            oci_config["fingerprint"] = config_items[1]
            oci_config["tenancy"] = config_items[2]
            oci_config["region"] = config_items[3]
            oci_config["compartment_id"] = config_items[4]
        else:
            raise CredentialsValidateFailedError("need to set oci_config_content in credentials ")
        if "oci_key_content" in credentials:
            oci_key_content = base64.b64decode(credentials.get("oci_key_content")).decode("utf-8")
            oci_config["key_content"] = oci_key_content.encode(encoding="utf-8")
        else:
            raise CredentialsValidateFailedError("need to set oci_config_content in credentials ")
        # oci_config = oci.config.from_file('~/.oci/config', credentials.get('oci_api_profile'))
        compartment_id = oci_config["compartment_id"]
        client = oci.generative_ai_inference.GenerativeAiInferenceClient(config=oci_config)
        # call embedding model
        request_args = copy.deepcopy(request_template)
        request_args["compartmentId"] = compartment_id
        request_args["servingMode"]["modelId"] = model
        request_args["inputs"] = texts
        response = client.embed_text(request_args)
        return response.data.embeddings, self.get_num_characters(model=model, credentials=credentials, texts=texts)

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
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [KeyError],
        }
