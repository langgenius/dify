from dify_graph.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from dify_graph.model_runtime.entities.text_embedding_entities import EmbeddingInputType, EmbeddingResult
from dify_graph.model_runtime.model_providers.__base.ai_model import AIModel


class TextEmbeddingModel(AIModel):
    """
    Model class for text embedding model.
    """

    model_type: ModelType = ModelType.TEXT_EMBEDDING

    def invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str] | None = None,
        multimodel_documents: list[dict] | None = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> EmbeddingResult:
        """
        Invoke text embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param files: files to embed
        :param input_type: input type
        :return: embeddings result
        """
        try:
            if texts:
                return self.model_runtime.invoke_text_embedding(
                    provider=self.provider,
                    model=model,
                    credentials=credentials,
                    texts=texts,
                    input_type=input_type,
                )
            if multimodel_documents:
                return self.model_runtime.invoke_multimodal_embedding(
                    provider=self.provider,
                    model=model,
                    credentials=credentials,
                    documents=multimodel_documents,
                    input_type=input_type,
                )
            raise ValueError("No texts or files provided")
        except Exception as e:
            raise self._transform_invoke_error(e)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> list[int]:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return self.model_runtime.get_text_embedding_num_tokens(
            provider=self.provider,
            model=model,
            credentials=credentials,
            texts=texts,
        )

    def _get_context_size(self, model: str, credentials: dict) -> int:
        """
        Get context size for given embedding model

        :param model: model name
        :param credentials: model credentials
        :return: context size
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.CONTEXT_SIZE in model_schema.model_properties:
            content_size: int = model_schema.model_properties[ModelPropertyKey.CONTEXT_SIZE]
            return content_size

        return 1000

    def _get_max_chunks(self, model: str, credentials: dict) -> int:
        """
        Get max chunks for given embedding model

        :param model: model name
        :param credentials: model credentials
        :return: max chunks
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties:
            max_chunks: int = model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
            return max_chunks

        return 1
