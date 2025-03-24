import decimal
import hashlib
from threading import Lock
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

import contexts
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    ModelType,
    PriceConfig,
    PriceInfo,
    PriceType,
)
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError, PluginModelProviderEntity
from core.plugin.manager.model import PluginModelManager


class AIModel(BaseModel):
    """
    Base class for all models.
    """

    tenant_id: str = Field(description="Tenant ID")
    model_type: ModelType = Field(description="Model type")
    plugin_id: str = Field(description="Plugin ID")
    provider_name: str = Field(description="Provider")
    plugin_model_provider: PluginModelProviderEntity = Field(description="Plugin model provider")
    started_at: float = Field(description="Invoke start time", default=0)

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @property
    def _invoke_error_mapping(self) -> dict[type[Exception], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError],
            PluginDaemonInnerError: [PluginDaemonInnerError],
            ValueError: [ValueError],
        }

    def _transform_invoke_error(self, error: Exception) -> Exception:
        """
        Transform invoke error to unified error

        :param error: model invoke error
        :return: unified error
        """
        for invoke_error, model_errors in self._invoke_error_mapping.items():
            if isinstance(error, tuple(model_errors)):
                if invoke_error == InvokeAuthorizationError:
                    return InvokeAuthorizationError(
                        description=(
                            f"[{self.provider_name}] Incorrect model credentials provided, please check and try again."
                        )
                    )
                elif isinstance(invoke_error, InvokeError):
                    return InvokeError(description=f"[{self.provider_name}] {invoke_error.description}, {str(error)}")
                else:
                    return error

        return InvokeError(description=f"[{self.provider_name}] Error: {str(error)}")

    def get_price(self, model: str, credentials: dict, price_type: PriceType, tokens: int) -> PriceInfo:
        """
        Get price for given model and tokens

        :param model: model name
        :param credentials: model credentials
        :param price_type: price type
        :param tokens: number of tokens
        :return: price info
        """
        # get model schema
        model_schema = self.get_model_schema(model, credentials)

        # get price info from predefined model schema
        price_config: Optional[PriceConfig] = None
        if model_schema and model_schema.pricing:
            price_config = model_schema.pricing

        # get unit price
        unit_price = None
        if price_config:
            if price_type == PriceType.INPUT:
                unit_price = price_config.input
            elif price_type == PriceType.OUTPUT and price_config.output is not None:
                unit_price = price_config.output

        if unit_price is None:
            return PriceInfo(
                unit_price=decimal.Decimal("0.0"),
                unit=decimal.Decimal("0.0"),
                total_amount=decimal.Decimal("0.0"),
                currency="USD",
            )

        # calculate total amount
        if not price_config:
            raise ValueError(f"Price config not found for model {model}")
        total_amount = tokens * unit_price * price_config.unit
        total_amount = total_amount.quantize(decimal.Decimal("0.0000001"), rounding=decimal.ROUND_HALF_UP)

        return PriceInfo(
            unit_price=unit_price,
            unit=price_config.unit,
            total_amount=total_amount,
            currency=price_config.currency,
        )

    def get_model_schema(self, model: str, credentials: Optional[dict] = None) -> Optional[AIModelEntity]:
        """
        Get model schema by model name and credentials

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        plugin_model_manager = PluginModelManager()
        cache_key = f"{self.tenant_id}:{self.plugin_id}:{self.provider_name}:{self.model_type.value}:{model}"
        # sort credentials
        sorted_credentials = sorted(credentials.items()) if credentials else []
        cache_key += ":".join([hashlib.md5(f"{k}:{v}".encode()).hexdigest() for k, v in sorted_credentials])

        try:
            contexts.plugin_model_schemas.get()
        except LookupError:
            contexts.plugin_model_schemas.set({})
            contexts.plugin_model_schema_lock.set(Lock())

        with contexts.plugin_model_schema_lock.get():
            if cache_key in contexts.plugin_model_schemas.get():
                return contexts.plugin_model_schemas.get()[cache_key]

            schema = plugin_model_manager.get_model_schema(
                tenant_id=self.tenant_id,
                user_id="unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model_type=self.model_type.value,
                model=model,
                credentials=credentials or {},
            )

            if schema:
                contexts.plugin_model_schemas.get()[cache_key] = schema

            return schema

    def get_customizable_model_schema_from_credentials(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        Get customizable model schema from credentials

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """

        # get customizable model schema
        schema = self.get_customizable_model_schema(model, credentials)
        if not schema:
            return None

        # fill in the template
        new_parameter_rules = []
        for parameter_rule in schema.parameter_rules:
            if parameter_rule.use_template:
                try:
                    default_parameter_name = DefaultParameterName.value_of(parameter_rule.use_template)
                    default_parameter_rule = self._get_default_parameter_rule_variable_map(default_parameter_name)
                    if not parameter_rule.max and "max" in default_parameter_rule:
                        parameter_rule.max = default_parameter_rule["max"]
                    if not parameter_rule.min and "min" in default_parameter_rule:
                        parameter_rule.min = default_parameter_rule["min"]
                    if not parameter_rule.default and "default" in default_parameter_rule:
                        parameter_rule.default = default_parameter_rule["default"]
                    if not parameter_rule.precision and "precision" in default_parameter_rule:
                        parameter_rule.precision = default_parameter_rule["precision"]
                    if not parameter_rule.required and "required" in default_parameter_rule:
                        parameter_rule.required = default_parameter_rule["required"]
                    if not parameter_rule.help and "help" in default_parameter_rule:
                        parameter_rule.help = I18nObject(
                            en_US=default_parameter_rule["help"]["en_US"],
                        )
                    if (
                        parameter_rule.help
                        and not parameter_rule.help.en_US
                        and ("help" in default_parameter_rule and "en_US" in default_parameter_rule["help"])
                    ):
                        parameter_rule.help.en_US = default_parameter_rule["help"]["en_US"]
                    if (
                        parameter_rule.help
                        and not parameter_rule.help.zh_Hans
                        and ("help" in default_parameter_rule and "zh_Hans" in default_parameter_rule["help"])
                    ):
                        parameter_rule.help.zh_Hans = default_parameter_rule["help"].get(
                            "zh_Hans", default_parameter_rule["help"]["en_US"]
                        )
                except ValueError:
                    pass

            new_parameter_rules.append(parameter_rule)

        schema.parameter_rules = new_parameter_rules

        return schema

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        Get customizable model schema

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        return None

    def _get_default_parameter_rule_variable_map(self, name: DefaultParameterName) -> dict:
        """
        Get default parameter rule for given name

        :param name: parameter name
        :return: parameter rule
        """
        default_parameter_rule = PARAMETER_RULE_TEMPLATE.get(name)

        if not default_parameter_rule:
            raise Exception(f"Invalid model parameter rule name {name}")

        return default_parameter_rule

    def _get_num_tokens_by_gpt2(self, text: str) -> int:
        """
        Get number of tokens for given prompt messages by gpt2
        Some provider models do not provide an interface for obtaining the number of tokens.
        Here, the gpt2 tokenizer is used to calculate the number of tokens.
        This method can be executed offline, and the gpt2 tokenizer has been cached in the project.

        :param text: plain text of prompt. You need to convert the original message to plain text
        :return: number of tokens
        """
        return GPT2Tokenizer.get_num_tokens(text)
