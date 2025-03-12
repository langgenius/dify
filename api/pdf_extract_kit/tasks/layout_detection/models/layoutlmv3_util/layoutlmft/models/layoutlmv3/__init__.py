from transformers import AutoConfig, AutoModel, AutoModelForTokenClassification, \
    AutoModelForQuestionAnswering, AutoModelForSequenceClassification, AutoTokenizer
from transformers.convert_slow_tokenizer import SLOW_TO_FAST_CONVERTERS, RobertaConverter

from .configuration_layoutlmv3 import LayoutLMv3Config
from .modeling_layoutlmv3 import (
    LayoutLMv3ForTokenClassification,
    LayoutLMv3ForQuestionAnswering,
    LayoutLMv3ForSequenceClassification,
    LayoutLMv3Model,
)
from .tokenization_layoutlmv3 import LayoutLMv3Tokenizer
from .tokenization_layoutlmv3_fast import LayoutLMv3TokenizerFast


#AutoConfig.register("layoutlmv3", LayoutLMv3Config)
#AutoModel.register(LayoutLMv3Config, LayoutLMv3Model)
#AutoModelForTokenClassification.register(LayoutLMv3Config, LayoutLMv3ForTokenClassification)
#AutoModelForQuestionAnswering.register(LayoutLMv3Config, LayoutLMv3ForQuestionAnswering)
#AutoModelForSequenceClassification.register(LayoutLMv3Config, LayoutLMv3ForSequenceClassification)
#AutoTokenizer.register(
#    LayoutLMv3Config, slow_tokenizer_class=LayoutLMv3Tokenizer, fast_tokenizer_class=LayoutLMv3TokenizerFast
#)
SLOW_TO_FAST_CONVERTERS.update({"LayoutLMv3Tokenizer": RobertaConverter})
