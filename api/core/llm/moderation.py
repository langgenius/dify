import openai
from flask import current_app
from models.provider import ProviderName


class Moderation:

    def __init__(self, provider: str, api_key: str):
        self.provider = provider
        self.api_key = api_key

        # Use proxy openai base
        if current_app.config['OPENAI_API_BASE'] is not None:
            openai.api_base = current_app.config['OPENAI_API_BASE']

        if self.provider == ProviderName.OPENAI.value:
            self.client = openai.Moderation

    def moderate(self, text):
        return self.client.create(input=text, api_key=self.api_key)
