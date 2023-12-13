import decimal
import os
from abc import ABC, abstractmethod
from typing import Optional

import yaml

from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.model_entities import PriceInfo, AIModelEntity, PriceType, PriceConfig, \
    DefaultParameterName, FetchFrom
from core.model_runtime.errors.invoke import InvokeError, InvokeAuthorizationError


class AIModel(ABC):
    """
    Base class for all models.
    """
    model_schemas: list[AIModelEntity] = None
    started_at: float = 0

    @abstractmethod
    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        raise NotImplementedError

    @property
    @abstractmethod
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        raise NotImplementedError

    def _transform_invoke_error(self, error: Exception) -> InvokeError:
        """
        Transform invoke error to unified error

        :param error: model invoke error
        :return: unified error
        """
        for invoke_error, model_errors in self._invoke_error_mapping.items():
            if isinstance(error, tuple(model_errors)):
                if invoke_error == InvokeAuthorizationError:
                    return invoke_error(description="Incorrect model credentials provided, please check and try again. ")

                return invoke_error(description=f"{invoke_error.description}: {str(error)}")

        return InvokeError(description=f"Error: {str(error)}")

    def remote_models(self, credentials: dict) -> list[AIModelEntity]:
        """
        Return remote models if credentials are provided.

        :param credentials: provider credentials
        :return:
        """
        return []

    def predefined_models(self) -> list[AIModelEntity]:
        """
        Get all predefined models for given provider.

        :return: list of predefined models
        """
        # get all model schema files for given model type
        return self.get_model_schemas()

    def get_price(self, model: str, price_type: PriceType, tokens: int) -> PriceInfo:
        """
        Get price for given model and tokens

        :param model: model name
        :param price_type: price type
        :param tokens: number of tokens
        :return: price info
        """
        # get predefined model schema
        predefined_model_schema = self.get_predefined_model_schema(model)

        # get price info from predefined model schema
        price_config: Optional[PriceConfig] = None
        if predefined_model_schema:
            price_config: PriceConfig = predefined_model_schema.pricing

        # get unit price
        unit_price = None
        if price_config:
            if price_type == PriceType.INPUT:
                unit_price = price_config.input
            elif price_type == PriceType.OUTPUT and price_config.output is not None:
                unit_price = price_config.output

        if unit_price is None:
            return PriceInfo(
                unit_price=decimal.Decimal('0.0'),
                unit=decimal.Decimal('0.0'),
                total_amount=decimal.Decimal('0.0'),
                currency="USD",
            )

        # calculate total amount
        total_amount = tokens * unit_price * price_config.unit
        total_amount = total_amount.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

        return PriceInfo(
            unit_price=unit_price,
            unit=price_config.unit,
            total_amount=total_amount,
            currency=price_config.currency,
        )

    def get_model_schemas(self) -> list[AIModelEntity]:
        """
        Get model schemas

        :return:
        """
        if self.model_schemas:
            return self.model_schemas

        model_schemas = []

        # get module name
        model_type = self.__class__.__module__.split('.')[-1]

        # get provider name
        provider_name = self.__class__.__module__.split('.')[-3]

        # get the path of current classes
        current_path = os.path.abspath(__file__)
        # get parent path of the current path
        provider_model_type_path = os.path.join(os.path.dirname(os.path.dirname(current_path)), provider_name, model_type)

        # get all yaml files path under provider_model_type_path that do not start with __
        model_schema_yaml_paths = [
            os.path.join(provider_model_type_path, model_schema_yaml)
            for model_schema_yaml in os.listdir(provider_model_type_path)
            if not model_schema_yaml.startswith('__')
               and not model_schema_yaml.startswith('_')
               and os.path.isfile(os.path.join(provider_model_type_path, model_schema_yaml))
               and model_schema_yaml.endswith('.yaml')
        ]

        # get _position.yaml file path
        position_file_path = os.path.join(provider_model_type_path, '_position.yaml')

        # read _position.yaml file
        position_map = {}
        if os.path.exists(position_file_path):
            with open(position_file_path, 'r') as f:
                position_map = yaml.safe_load(f)

        # traverse all model_schema_yaml_paths
        for model_schema_yaml_path in model_schema_yaml_paths:
            # read yaml data from yaml file
            with open(model_schema_yaml_path, 'r') as f:
                yaml_data = yaml.safe_load(f)

            new_parameter_rules = []
            for parameter_rule in yaml_data.get('parameter_rules', []):
                if 'use_template' in parameter_rule:
                    try:
                        default_parameter_name = DefaultParameterName.value_of(parameter_rule['use_template'])
                        default_parameter_rule = self._get_default_parameter_rule_variable_map(default_parameter_name)
                        copy_default_parameter_rule = default_parameter_rule.copy()
                        copy_default_parameter_rule.update(parameter_rule)
                        parameter_rule = copy_default_parameter_rule
                    except ValueError:
                        pass

                if 'label' not in parameter_rule:
                    parameter_rule['label'] = {
                        'zh_Hans': parameter_rule['name'],
                        'en_US': parameter_rule['name']
                    }

                new_parameter_rules.append(parameter_rule)

            yaml_data['parameter_rules'] = new_parameter_rules

            if 'label' not in yaml_data:
                yaml_data['label'] = {
                    'zh_Hans': yaml_data['model'],
                    'en_US': yaml_data['model']
                }

            yaml_data['fetch_from'] = FetchFrom.PREDEFINED_MODEL.value

            # yaml_data to entity
            model_schema = AIModelEntity(**yaml_data)

            # cache model schema
            model_schemas.append(model_schema)

        # resort model schemas by position
        if position_map:
            model_schemas.sort(key=lambda x: position_map.get(x.model, 999))

        # cache model schemas
        self.model_schemas = model_schemas

        return model_schemas

    def get_predefined_model_schema(self, model: str) -> Optional[AIModelEntity]:
        """
        Get model schema by model name
        Only used for predefined models

        :param model: model name
        :return: model schema
        """
        # get all model schema files for given model type
        model_schemas = self.get_model_schemas()

        # find model schema by model name
        for model_schema in model_schemas:
            if model_schema.model == model:
                return model_schema

        return None

    def _get_default_parameter_rule_variable_map(self, name: DefaultParameterName) -> dict:
        """
        Get default parameter rule for given name

        :param name: parameter name
        :return: parameter rule
        """
        default_parameter_rule = PARAMETER_RULE_TEMPLATE.get(name)

        if not default_parameter_rule:
            raise Exception(f'Invalid model parameter rule name {name}')

        return default_parameter_rule
