from pydantic import BaseModel

from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    I18nObject,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    PriceConfig,
)

AZURE_OPENAI_API_VERSION = "2024-02-15-preview"

AZURE_DEFAULT_PARAM_SEED_HELP = I18nObject(
    zh_Hans="如果指定，模型将尽最大努力进行确定性采样，使得重复的具有相同种子和参数的请求应该返回相同的结果。不能保证确定性，"
    "您应该参考 system_fingerprint 响应参数来监视变化。",
    en_US="If specified, model will make a best effort to sample deterministically,"
    " such that repeated requests with the same seed and parameters should return the same result."
    " Determinism is not guaranteed, and you should refer to the system_fingerprint response parameter"
    " to monitor changes in the backend.",
)


def _get_max_tokens(default: int, min_val: int, max_val: int) -> ParameterRule:
    rule = ParameterRule(
        name="max_tokens",
        **PARAMETER_RULE_TEMPLATE[DefaultParameterName.MAX_TOKENS],
    )
    rule.default = default
    rule.min = min_val
    rule.max = max_val
    return rule


def _get_o1_max_tokens(default: int, min_val: int, max_val: int) -> ParameterRule:
    rule = ParameterRule(
        name="max_completion_tokens",
        **PARAMETER_RULE_TEMPLATE[DefaultParameterName.MAX_TOKENS],
    )
    rule.default = default
    rule.min = min_val
    rule.max = max_val
    return rule


class AzureBaseModel(BaseModel):
    base_model_name: str
    entity: AIModelEntity


LLM_BASE_MODELS = [
    AzureBaseModel(
        base_model_name="gpt-35-turbo",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 16385,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.0005,
                output=0.0015,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-35-turbo-16k",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 16385,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=16385),
            ],
            pricing=PriceConfig(
                input=0.003,
                output=0.004,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-35-turbo-0125",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 16385,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.0005,
                output=0.0015,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 8192,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=8192),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.03,
                output=0.06,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-32k",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 32768,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=32768),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.06,
                output=0.12,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-0125-preview",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.01,
                output=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-1106-preview",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.01,
                output=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4o-mini",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=16384),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.150,
                output=0.600,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4o-mini-2024-07-18",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=16384),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object", "json_schema"],
                ),
                ParameterRule(
                    name="json_schema",
                    label=I18nObject(en_US="JSON Schema"),
                    type="text",
                    help=I18nObject(
                        zh_Hans="设置返回的json schema，llm将按照它返回",
                        en_US="Set a response json schema will ensure LLM to adhere it.",
                    ),
                    required=False,
                ),
            ],
            pricing=PriceConfig(
                input=0.150,
                output=0.600,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4o",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=5.00,
                output=15.00,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4o-2024-05-13",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=5.00,
                output=15.00,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4o-2024-08-06",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object", "json_schema"],
                ),
                ParameterRule(
                    name="json_schema",
                    label=I18nObject(en_US="JSON Schema"),
                    type="text",
                    help=I18nObject(
                        zh_Hans="设置返回的json schema，llm将按照它返回",
                        en_US="Set a response json schema will ensure LLM to adhere it.",
                    ),
                    required=False,
                ),
            ],
            pricing=PriceConfig(
                input=5.00,
                output=15.00,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-turbo",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.01,
                output=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-turbo-2024-04-09",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
                ModelFeature.VISION,
                ModelFeature.MULTI_TOOL_CALL,
                ModelFeature.STREAM_TOOL_CALL,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.01,
                output=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-4-vision-preview",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[ModelFeature.VISION],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
                ParameterRule(
                    name="seed",
                    label=I18nObject(zh_Hans="种子", en_US="Seed"),
                    type="int",
                    help=AZURE_DEFAULT_PARAM_SEED_HELP,
                    required=False,
                    precision=2,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
            ],
            pricing=PriceConfig(
                input=0.01,
                output=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="gpt-35-turbo-instruct",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.COMPLETION.value,
                ModelPropertyKey.CONTEXT_SIZE: 4096,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
            ],
            pricing=PriceConfig(
                input=0.0015,
                output=0.002,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="text-davinci-003",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.COMPLETION.value,
                ModelPropertyKey.CONTEXT_SIZE: 4096,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TEMPERATURE],
                ),
                ParameterRule(
                    name="top_p",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.TOP_P],
                ),
                ParameterRule(
                    name="presence_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.PRESENCE_PENALTY],
                ),
                ParameterRule(
                    name="frequency_penalty",
                    **PARAMETER_RULE_TEMPLATE[DefaultParameterName.FREQUENCY_PENALTY],
                ),
                _get_max_tokens(default=512, min_val=1, max_val=4096),
            ],
            pricing=PriceConfig(
                input=0.02,
                output=0.02,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="o1-preview",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
                _get_o1_max_tokens(default=512, min_val=1, max_val=32768),
            ],
            pricing=PriceConfig(
                input=15.00,
                output=60.00,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="o1-mini",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(
                en_US="fake-deployment-name-label",
            ),
            model_type=ModelType.LLM,
            features=[
                ModelFeature.AGENT_THOUGHT,
            ],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
                ModelPropertyKey.CONTEXT_SIZE: 128000,
            },
            parameter_rules=[
                ParameterRule(
                    name="response_format",
                    label=I18nObject(zh_Hans="回复格式", en_US="response_format"),
                    type="string",
                    help=I18nObject(
                        zh_Hans="指定模型必须输出的格式", en_US="specifying the format that the model must output"
                    ),
                    required=False,
                    options=["text", "json_object"],
                ),
                _get_o1_max_tokens(default=512, min_val=1, max_val=65536),
            ],
            pricing=PriceConfig(
                input=3.00,
                output=12.00,
                unit=0.000001,
                currency="USD",
            ),
        ),
    ),
]
EMBEDDING_BASE_MODELS = [
    AzureBaseModel(
        base_model_name="text-embedding-ada-002",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: 8097,
                ModelPropertyKey.MAX_CHUNKS: 32,
            },
            pricing=PriceConfig(
                input=0.0001,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="text-embedding-3-small",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: 8191,
                ModelPropertyKey.MAX_CHUNKS: 32,
            },
            pricing=PriceConfig(
                input=0.00002,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="text-embedding-3-large",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: 8191,
                ModelPropertyKey.MAX_CHUNKS: 32,
            },
            pricing=PriceConfig(
                input=0.00013,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
]
SPEECH2TEXT_BASE_MODELS = [
    AzureBaseModel(
        base_model_name="whisper-1",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.SPEECH2TEXT,
            model_properties={
                ModelPropertyKey.FILE_UPLOAD_LIMIT: 25,
                ModelPropertyKey.SUPPORTED_FILE_EXTENSIONS: "flac,mp3,mp4,mpeg,mpga,m4a,ogg,wav,webm",
            },
        ),
    )
]
TTS_BASE_MODELS = [
    AzureBaseModel(
        base_model_name="tts-1",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TTS,
            model_properties={
                ModelPropertyKey.DEFAULT_VOICE: "alloy",
                ModelPropertyKey.VOICES: [
                    {
                        "mode": "alloy",
                        "name": "Alloy",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "echo",
                        "name": "Echo",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "fable",
                        "name": "Fable",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "onyx",
                        "name": "Onyx",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "nova",
                        "name": "Nova",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "shimmer",
                        "name": "Shimmer",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                ],
                ModelPropertyKey.WORD_LIMIT: 120,
                ModelPropertyKey.AUDIO_TYPE: "mp3",
                ModelPropertyKey.MAX_WORKERS: 5,
            },
            pricing=PriceConfig(
                input=0.015,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
    AzureBaseModel(
        base_model_name="tts-1-hd",
        entity=AIModelEntity(
            model="fake-deployment-name",
            label=I18nObject(en_US="fake-deployment-name-label"),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TTS,
            model_properties={
                ModelPropertyKey.DEFAULT_VOICE: "alloy",
                ModelPropertyKey.VOICES: [
                    {
                        "mode": "alloy",
                        "name": "Alloy",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "echo",
                        "name": "Echo",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "fable",
                        "name": "Fable",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "onyx",
                        "name": "Onyx",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "nova",
                        "name": "Nova",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                    {
                        "mode": "shimmer",
                        "name": "Shimmer",
                        "language": ["zh-Hans", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "th-TH", "id-ID"],
                    },
                ],
                ModelPropertyKey.WORD_LIMIT: 120,
                ModelPropertyKey.AUDIO_TYPE: "mp3",
                ModelPropertyKey.MAX_WORKERS: 5,
            },
            pricing=PriceConfig(
                input=0.03,
                unit=0.001,
                currency="USD",
            ),
        ),
    ),
]
