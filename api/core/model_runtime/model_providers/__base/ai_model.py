import decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from core.model_runtime.entities.model_entities import (
    AIModelEntity,
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
                    return invoke_error(description=f"[{self.provider_name}] {invoke_error.description}, {str(error)}")
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
        return plugin_model_manager.get_model_schema(
            tenant_id=self.tenant_id,
            user_id="unknown",
            plugin_id=self.plugin_id,
            provider=self.provider_name,
            model_type=self.model_type.value,
            model=model,
            credentials=credentials or {},
        )
