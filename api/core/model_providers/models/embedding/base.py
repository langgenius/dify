from abc import abstractmethod
from typing import Any
import decimal

import tiktoken
from langchain.schema.language_model import _get_token_ids_default_method

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider


class BaseEmbedding(BaseProviderModel):
    name: str
    type: ModelType = ModelType.EMBEDDINGS

    def __init__(self, model_provider: BaseModelProvider, client: Any, name: str):
        super().__init__(model_provider, client)
        self.name = name

    @property
    def model_unit_prices_config(self):
        """
        get model unit prices config.

        :return: object format {
            "model_name": {
                'completion': decimal.Decimal('0'),
                'unit': decimal.Decimal('0'),
            }
        }
        """
        base_model_name = self.name
        return {
            base_model_name:{
                'completion': decimal.Decimal('0'),
                'unit': decimal.Decimal('0'),
            }
        }

    def calc_tokens_price(self, tokens:int):
        """
        calc tokens total price.

        :param tokens:
        :return: decimal.Decimal('0.0000001')
        """
        base_model_name = self.name
        unit_price = self.model_unit_prices_config[base_model_name]['completion']
        unit = self.model_unit_prices_config[base_model_name]['unit']
        total_price = tokens * unit_price * unit
        return total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

    def get_tokens_unit_price(self):
        """
        get token price.

        :return: decimal.Decimal('0.0001')
        
        """
        base_model_name = self.name
        unit_price = self.model_unit_prices_config[base_model_name]['completion']
        return unit_price.quantize(decimal.Decimal('0.0001'), rounding=decimal.ROUND_HALF_UP)


    def get_num_tokens(self, text: str) -> int:
        """
        get num tokens of text.

        :param text:
        :return:
        """
        if len(text) == 0:
            return 0

        return len(_get_token_ids_default_method(text))

    def get_currency(self):
        return 'USD'

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        raise NotImplementedError
