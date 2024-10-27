from typing import Optional

from openai import OpenAI
from openai.types import ModerationCreateResponse

from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.moderation_model import ModerationModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI


class OpenAIModerationModel(_CommonOpenAI, ModerationModel):
    """
    Model class for OpenAI text moderation model.
    """

    def _invoke(self, model: str, credentials: dict,
                text: str, user: Optional[str] = None) \
            -> bool:
        """
        Invoke moderation model

        :param model: model name
        :param credentials: model credentials
        :param text: text to moderate
        :param user: unique user id
        :return: false if text is safe, true otherwise
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # init model client
        client = OpenAI(**credentials_kwargs)

        # chars per chunk
        length = self._get_max_characters_per_chunk(model, credentials)
        text_chunks = [text[i:i + length] for i in range(0, len(text), length)]

        max_text_chunks = self._get_max_chunks(model, credentials)
        chunks = [text_chunks[i:i + max_text_chunks] for i in range(0, len(text_chunks), max_text_chunks)]

        for text_chunk in chunks:
            moderation_result = self._moderation_invoke(model=model, client=client, texts=text_chunk)

            for result in moderation_result.results:
                if result.flagged is True:
                    return True

        return False

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)

            # call moderation model
            self._moderation_invoke(
                model=model,
                client=client,
                texts=['ping'],
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _moderation_invoke(self, model: str, client: OpenAI, texts: list[str]) -> ModerationCreateResponse:
        """
        Invoke moderation model

        :param model: model name
        :param client: model client
        :param texts: texts to moderate
        :return: false if text is safe, true otherwise
        """
        # call moderation model
        moderation_result = client.moderations.create(model=model, input=texts)

        return moderation_result

    def _get_max_characters_per_chunk(self, model: str, credentials: dict) -> int:
        """
        Get max characters per chunk

        :param model: model name
        :param credentials: model credentials
        :return: max characters per chunk
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.MAX_CHARACTERS_PER_CHUNK in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.MAX_CHARACTERS_PER_CHUNK]

        return 2000

    def _get_max_chunks(self, model: str, credentials: dict) -> int:
        """
        Get max chunks for given embedding model

        :param model: model name
        :param credentials: model credentials
        :return: max chunks
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]

        return 1
