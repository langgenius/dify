import time
from typing import Optional
import dashscope
import numpy as np
from dify_plugin.entities.model import EmbeddingInputType, PriceType
from dify_plugin.entities.model.text_embedding import EmbeddingUsage, TextEmbeddingResult
from dify_plugin.errors.model import CredentialsValidateFailedError
from dify_plugin.interfaces.model.text_embedding_model import TextEmbeddingModel
from models._common import _CommonTongyi


class TongyiTextEmbeddingModel(_CommonTongyi, TextEmbeddingModel):
    """
    Model class for Tongyi text embedding model.
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
        credentials_kwargs = self._to_credential_kwargs(credentials)
        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)
        inputs = []
        indices = []
        used_tokens = 0
        for i, text in enumerate(texts):
            num_tokens = self._get_num_tokens_by_gpt2(text)
            if num_tokens >= context_size:
                cutoff = int(np.floor(len(text) * (context_size / num_tokens)))
                inputs.append(text[0:cutoff])
            else:
                inputs.append(text)
            indices += [i]
        batched_embeddings = []
        _iter = range(0, len(inputs), max_chunks)
        for i in _iter:
            (embeddings_batch, embedding_used_tokens) = self.embed_documents(
                credentials_kwargs=credentials_kwargs, model=model, texts=inputs[i : i + max_chunks]
            )
            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch
        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=used_tokens)
        return TextEmbeddingResult(embeddings=batched_embeddings, usage=usage, model=model)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> list[int]:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        if len(texts) == 0:
            return []
        tokens = []
        for text in texts:
            tokens.append(self._get_num_tokens_by_gpt2(text))
        return tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            credentials_kwargs = self._to_credential_kwargs(credentials)
            self.embed_documents(credentials_kwargs=credentials_kwargs, model=model, texts=["ping"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @staticmethod
    def embed_documents(credentials_kwargs: dict, model: str, texts: list[str]) -> tuple[list[list[float]], int]:
        """Call out to Tongyi's embedding endpoint.

        Args:
            credentials_kwargs: The credentials to use for the call.
            model: The model to use for embedding.
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text, and tokens usage.
        """
        embeddings = []
        embedding_used_tokens = 0
        
        def call_embedding_api(text):
            try:
                return dashscope.TextEmbedding.call(
                    api_key=credentials_kwargs["dashscope_api_key"], 
                    model=model, 
                    input=text, 
                    text_type="document"
                )
            except Exception as e:
                # Return the exception to be handled by the caller
                return e
            
        for text in texts:
            # First attempt
            response = call_embedding_api(text)
            
            # Handle rate limit error (429)
            # Check if response is an exception with rate limit info
            if hasattr(response, 'status_code') and response.status_code == 429:
                print(f"Rate limit exceeded (429). Response: {response}")
                import time
                time.sleep(10)
                # Retry once after sleeping
                response = call_embedding_api(text)
            
            # Process response
            if hasattr(response, 'output') and response.output and "embeddings" in response.output and response.output["embeddings"]:
                data = response.output["embeddings"][0]
                if "embedding" in data:
                    embeddings.append(data["embedding"])
                else:
                    raise ValueError(f"Embedding data is missing in the response: {response}")
            else:
                raise ValueError(f"Response output is missing or does not contain embeddings: {response}")
                
            if hasattr(response, 'usage') and response.usage and "total_tokens" in response.usage:
                embedding_used_tokens += response.usage["total_tokens"]
            else:
                raise ValueError(f"Response usage is missing or does not contain total tokens: {response}")
                
        return ([list(map(float, e)) for e in embeddings], embedding_used_tokens)

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param tokens: input tokens
        :return: usage
        """
        input_price_info = self.get_price(
            model=model, credentials=credentials, price_type=PriceType.INPUT, tokens=tokens
        )
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
