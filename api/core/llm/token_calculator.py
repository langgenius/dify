import decimal
from typing import Optional

import tiktoken

from core.constant import llm_constant


class TokenCalculator:
    @classmethod
    def get_num_tokens(cls, model_name: str, text: str):
        if len(text) == 0:
            return 0

        enc = tiktoken.encoding_for_model(model_name)

        tokenized_text = enc.encode(text)

        # calculate the number of tokens in the encoded text
        return len(tokenized_text)

    @classmethod
    def get_token_price(cls, model_name: str, tokens: int, text_type: Optional[str] = None) -> decimal.Decimal:
        if model_name in llm_constant.models_by_mode['embedding']:
            unit_price = llm_constant.model_prices[model_name]['usage']
        elif text_type == 'prompt':
            unit_price = llm_constant.model_prices[model_name]['prompt']
        elif text_type == 'completion':
            unit_price = llm_constant.model_prices[model_name]['completion']
        else:
            raise Exception('Invalid text type')

        tokens_per_1k = (decimal.Decimal(tokens) / 1000).quantize(decimal.Decimal('0.001'),
                                                                  rounding=decimal.ROUND_HALF_UP)

        total_price = tokens_per_1k * unit_price
        return total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

    @classmethod
    def get_currency(cls, model_name: str):
        return llm_constant.model_currency
