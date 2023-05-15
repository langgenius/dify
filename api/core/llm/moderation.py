import openai
from models.provider import ProviderName


class Moderation:

    def __init__(self, provider: str, api_key: str):
        self.provider = provider
        self.api_key = api_key

        if self.provider == ProviderName.OPENAI.value:
            self.client = openai.Moderation

    def moderate(self, text):
        return self.client.create(input=text, api_key=self.api_key)
