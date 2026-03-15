import decimal

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from dify_graph.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    ModelType,
    PriceConfig,
    PriceInfo,
    PriceType,
)
from dify_graph.model_runtime.entities.provider_entities import ProviderEntity
from dify_graph.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from dify_graph.model_runtime.runtime import ModelRuntime


class AIModel:
    """
    Runtime-facing base class for all model providers.

    This stays a regular Python class because instances hold live collaborators
    such as the provider schema and runtime adapter rather than user input that
    benefits from Pydantic validation. Subclasses must pin ``model_type`` via a
    class attribute; the base class is not meant to be instantiated directly.
    """

    model_type: ModelType
    provider_schema: ProviderEntity
    model_runtime: ModelRuntime
    started_at: float

    def __init__(
        self,
        provider_schema: ProviderEntity,
        model_runtime: ModelRuntime,
        *,
        started_at: float = 0,
    ) -> None:
        if getattr(type(self), "model_type", None) is None:
            raise TypeError("AIModel subclasses must define model_type as a class attribute")

        self.model_type = type(self).model_type
        self.provider_schema = provider_schema
        self.model_runtime = model_runtime
        self.started_at = started_at

    @property
    def provider(self) -> str:
        return self.provider_schema.provider

    @property
    def provider_display_name(self) -> str:
        return self.provider_schema.label.en_US

    @property
    def _invoke_error_mapping(self) -> dict[type[Exception], list[type[Exception]]]:
        """
        Map model invoke error to unified error.

        The key is the error type thrown to the caller, and the value contains
        runtime-facing exception types that should be normalized to it.
        """
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError],
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
                            f"[{self.provider_display_name}] Incorrect model credentials provided, "
                            "please check and try again."
                        )
                    )
                elif isinstance(invoke_error, InvokeError):
                    return InvokeError(
                        description=f"[{self.provider_display_name}] {invoke_error.description}, {str(error)}"
                    )
                else:
                    return error

        return InvokeError(description=f"[{self.provider_display_name}] Error: {str(error)}")

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
        price_config: PriceConfig | None = None
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

    def get_model_schema(self, model: str, credentials: dict | None = None) -> AIModelEntity | None:
        """
        Get model schema by model name and credentials

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        return self.model_runtime.get_model_schema(
            provider=self.provider,
            model_type=self.model_type,
            model=model,
            credentials=credentials or {},
        )

    def get_customizable_model_schema_from_credentials(self, model: str, credentials: dict) -> AIModelEntity | None:
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

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        Get customizable model schema

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        return None

    def _get_default_parameter_rule_variable_map(self, name: DefaultParameterName):
        """
        Get default parameter rule for given name

        :param name: parameter name
        :return: parameter rule
        """
        default_parameter_rule = PARAMETER_RULE_TEMPLATE.get(name)

        if not default_parameter_rule:
            raise Exception(f"Invalid model parameter rule name {name}")

        return default_parameter_rule
