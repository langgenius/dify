import json
from typing import Optional

import numpy as np
from huggingface_hub import InferenceClient, HfApi
from huggingface_hub.utils import HfHubHTTPError

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult, EmbeddingUsage
from core.model_runtime.errors.invoke import InvokeError, InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel


class HuggingfaceHubTextEmbeddingModel(TextEmbeddingModel):

    def _invoke(self, model: str, credentials: dict, texts: list[str],
                user: Optional[str] = None) -> TextEmbeddingResult:
        client = InferenceClient(token=credentials['huggingfacehub_api_token'])

        execute_model = model

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            execute_model = credentials['huggingfacehub_endpoint_url']

        output = client.post(
            json={
                "inputs": texts,
                "options": {
                    "wait_for_model": False,
                    "use_cache": False
                }
            },
            model=execute_model)

        embeddings = json.loads(output.decode())

        usage = EmbeddingUsage(
            tokens=0,
            total_tokens=0,
            unit_price=0.0,
            price_unit=0.0,
            total_price=0.0,
            currency='USD',
            latency=0.0
        )

        return TextEmbeddingResult(
            embeddings=self._mean_pooling(embeddings),
            usage=usage,
            model=model
        )

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return 0

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if 'huggingfacehub_api_type' not in credentials:
            raise CredentialsValidateFailedError('Huggingface Hub Endpoint Type must be provided.')

        if 'huggingfacehub_api_token' not in credentials:
            raise CredentialsValidateFailedError('Huggingface Hub Access Token must be provided.')

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            if 'huggingface_namespace' not in credentials:
                raise CredentialsValidateFailedError('Huggingface Hub Namespace must be provided.')

            if 'huggingfacehub_endpoint_url' not in credentials:
                raise CredentialsValidateFailedError('Huggingface Hub Endpoint URL must be provided.')

            if 'task_type' not in credentials:
                raise CredentialsValidateFailedError('Huggingface Hub Task Type must be provided.')

            if credentials['task_type'] != 'feature-extraction':
                raise CredentialsValidateFailedError('Huggingface Hub Task Type is invalid.')

            model = credentials['huggingfacehub_endpoint_url']
        elif credentials['huggingfacehub_api_type'] == 'hosted_inference_api':
            self._check_hosted_model_task_type(credentials['huggingfacehub_api_token'],
                                               model)
        else:
            raise CredentialsValidateFailedError('Huggingface Hub Endpoint Type is invalid.')

        client = InferenceClient(token=credentials['huggingfacehub_api_token'])
        try:
            client.feature_extraction(text='hello world', model=model)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeBadRequestError: [
                HfHubHTTPError
            ]
        }

    # https://huggingface.co/docs/api-inference/detailed_parameters#feature-extraction-task
    # Returned values are a list of floats, or a list[list[floats]]
    # (depending on if you sent a string or a list of string,
    # and if the automatic reduction, usually mean_pooling for instance was applied for you or not.
    # This should be explained on the model's README.)
    @staticmethod
    def _mean_pooling(embeddings: list) -> list[float]:
        # If automatic reduction by giving model, no need to mean_pooling.
        # For example one: List[List[float]]
        if not isinstance(embeddings[0][0], list):
            return embeddings

        # For example two: List[List[List[float]]], need to mean_pooling.
        sentence_embeddings = [np.mean(embedding[0], axis=0).tolist() for embedding in embeddings]
        return sentence_embeddings

    @staticmethod
    def _check_hosted_model_task_type(huggingfacehub_api_token: str, model_name: str) -> None:
        hf_api = HfApi(token=huggingfacehub_api_token)
        model_info = hf_api.model_info(repo_id=model_name)

        try:
            if not model_info:
                raise ValueError(f'Model {model_name} not found.')

            if 'inference' in model_info.cardData and not model_info.cardData['inference']:
                raise ValueError(f'Inference API has been turned off for this model {model_name}.')

            valid_tasks = "feature-extraction"
            if model_info.pipeline_tag not in valid_tasks:
                raise ValueError(f"Model {model_name} is not a valid task, "
                                 f"must be one of {valid_tasks}.")
        except Exception as e:
            raise CredentialsValidateFailedError(f"{str(e)}")
