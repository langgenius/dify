import decimal
from typing import Any

from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    ModelType,
    PriceConfig,
    PriceInfo,
    PriceType,
)
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


class AIModel[RuntimeT: ModelProviderRuntime]:
    """Runtime-facing base class for all model providers.

    This stays a regular Python class because instances hold live collaborators
    such as the provider schema and runtime adapter rather than user input that
    benefits from Pydantic validation. Subclasses must pin ``model_type`` via a
    class attribute; the base class is not meant to be instantiated directly.
    """

    model_type: ModelType
    provider_schema: ProviderEntity
    model_runtime: RuntimeT
    started_at: float

    def __init__(
        self,
        provider_schema: ProviderEntity,
        model_runtime: RuntimeT,
        *,
        started_at: float = 0,
    ) -> None:
        if getattr(type(self), "model_type", None) is None:
            msg = "AIModel subclasses must define model_type as a class attribute"
            raise TypeError(msg)

        self.model_type = type(self).model_type
        self.provider_schema = provider_schema
        self.model_runtime = model_runtime
        self.started_at = started_at

    @property
    def provider(self) -> str:
        return self.provider_schema.provider

    @property
    def provider_display_name(self) -> str:
        return self.provider_schema.label.en_us

    @property
    def _invoke_error_mapping(self) -> dict[type[Exception], list[type[Exception]]]:
        """Map model invoke error to unified error.

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
        """Normalize provider/runtime exceptions into graphon-facing invoke errors."""
        for invoke_error, model_errors in self._invoke_error_mapping.items():
            if isinstance(error, tuple(model_errors)):
                if invoke_error == InvokeAuthorizationError:
                    return InvokeAuthorizationError(
                        description=(
                            f"[{self.provider_display_name}] Incorrect model "
                            "credentials provided, please check and try again."
                        ),
                    )
                if isinstance(invoke_error, InvokeError):
                    return InvokeError(
                        description=(
                            f"[{self.provider_display_name}] "
                            f"{invoke_error.description}, "
                            f"{error!s}"
                        ),
                    )
                return error

        return InvokeError(
            description=f"[{self.provider_display_name}] Error: {error!s}",
        )

    def get_price(
        self,
        model: str,
        credentials: dict,
        price_type: PriceType,
        tokens: int,
    ) -> PriceInfo:
        """Calculate pricing metadata for a token count on a given model."""
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
            msg = f"Price config not found for model {model}"
            raise ValueError(msg)
        total_amount = tokens * unit_price * price_config.unit
        total_amount = total_amount.quantize(
            decimal.Decimal("0.0000001"),
            rounding=decimal.ROUND_HALF_UP,
        )

        return PriceInfo(
            unit_price=unit_price,
            unit=price_config.unit,
            total_amount=total_amount,
            currency=price_config.currency,
        )

    def get_model_schema(
        self,
        model: str,
        credentials: dict | None = None,
    ) -> AIModelEntity | None:
        """Fetch the resolved model schema for a model and credential set."""
        return self.model_runtime.get_model_schema(
            provider=self.provider,
            model_type=self.model_type,
            model=model,
            credentials=credentials or {},
        )

    def get_customizable_model_schema_from_credentials(
        self,
        model: str,
        credentials: dict,
    ) -> AIModelEntity | None:
        """Resolve and hydrate a customizable model schema from credentials."""
        # get customizable model schema
        schema = self.get_customizable_model_schema(model, credentials)
        if not schema:
            return None

        schema.parameter_rules = [
            self._apply_parameter_rule_template(parameter_rule)
            for parameter_rule in schema.parameter_rules
        ]

        return schema

    def _apply_parameter_rule_template(self, parameter_rule: Any) -> Any:
        template_name = parameter_rule.use_template
        if not template_name:
            return parameter_rule

        try:
            default_parameter_name = DefaultParameterName.value_of(template_name)
        except ValueError:
            return parameter_rule

        default_parameter_rule = self._get_default_parameter_rule_variable_map(
            default_parameter_name,
        )
        self._hydrate_parameter_rule_defaults(parameter_rule, default_parameter_rule)
        self._hydrate_parameter_rule_help(parameter_rule, default_parameter_rule)
        return parameter_rule

    @staticmethod
    def _hydrate_parameter_rule_defaults(
        parameter_rule: Any,
        default_parameter_rule: dict[str, Any],
    ) -> None:
        for field_name in ("max", "min", "default", "precision", "required"):
            if (
                getattr(parameter_rule, field_name)
                or field_name not in default_parameter_rule
            ):
                continue
            setattr(parameter_rule, field_name, default_parameter_rule[field_name])

    @staticmethod
    def _hydrate_parameter_rule_help(
        parameter_rule: Any,
        default_parameter_rule: dict[str, Any],
    ) -> None:
        default_help = default_parameter_rule.get("help")
        if not isinstance(default_help, dict) or "en_US" not in default_help:
            return

        if not parameter_rule.help:
            parameter_rule.help = I18nObject(en_US=default_help["en_US"])
            return

        if not parameter_rule.help.en_us:
            parameter_rule.help.en_us = default_help["en_US"]
        if not parameter_rule.help.zh_hans:
            parameter_rule.help.zh_hans = default_help.get(
                "zh_Hans",
                default_help["en_US"],
            )

    def get_customizable_model_schema(
        self,
        model: str,
        credentials: dict,
    ) -> AIModelEntity | None:
        """Return the provider-specific customizable model schema, if supported."""
        _ = model
        _ = credentials
        return None

    def _get_default_parameter_rule_variable_map(
        self,
        name: DefaultParameterName,
    ) -> dict[str, Any]:
        """Look up the default parameter rule template for a named parameter."""
        default_parameter_rule = PARAMETER_RULE_TEMPLATE.get(name)

        if not default_parameter_rule:
            msg = f"Invalid model parameter rule name {name}"
            raise ValueError(msg)

        return default_parameter_rule
