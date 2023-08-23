from abc import abstractmethod
from typing import Any
import decimal

import tiktoken
from langchain.schema.language_model import _get_token_ids_default_method

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider
import logging
logger = logging.getLogger(__name__)

class BaseEmbedding(BaseProviderModel):
    name: str
    type: ModelType = ModelType.EMBEDDINGS

    def __init__(self, model_provider: BaseModelProvider, client: Any, name: str):
        super().__init__(model_provider, client)
        self.name = name

    @property
    def base_model_name(self) -> str:
        """
        get base model name
        
        :return: str
        """
        return self.name

    @property
    def price_config(self) -> dict:
        def get_or_default():
            default_price_config = {
                    'completion': decimal.Decimal('0'),
                    'unit': decimal.Decimal('0'),
                    'currency': 'USD'
                }
            rules = self.model_provider.get_rules()
            price_config = rules['price_config'][self.base_model_name] if 'price_config' in rules else default_price_config
            price_config = {
                'completion': decimal.Decimal(price_config['completion']),
                'unit': decimal.Decimal(price_config['unit']),
                'currency': price_config['currency']
            }
            return price_config
        
        self._price_config = self._price_config if hasattr(self, '_price_config') else get_or_default()

        logger.debug(f"model: {self.name} price_config: {self._price_config}")
        return self._price_config

    def calc_tokens_price(self, tokens: int) -> decimal.Decimal:
        """
        calc tokens total price.

        :param tokens:
        :return: decimal.Decimal('0.0000001')
        """
        unit_price = self.price_config['completion']
        unit = self.price_config['unit']
        total_price = tokens * unit_price * unit
        total_price = total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)
        logging.debug(f"tokens={tokens}, unit_price={unit_price}, unit={unit}, total_price:{total_price}")
        return total_price

    def get_tokens_unit_price(self) -> decimal.Decimal:
        """
        get token price.

        :return: decimal.Decimal('0.0001')
        
        """
        unit_price = self.price_config['completion']
        unit_price = unit_price.quantize(decimal.Decimal('0.0001'), rounding=decimal.ROUND_HALF_UP)
        logger.debug(f'unit_price:{unit_price}')
        return unit_price

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
        """
        get token currency.

        :return: get from price config, default 'USD'
        """
        currency = self.price_config['currency']
        return currency

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        raise NotImplementedError
