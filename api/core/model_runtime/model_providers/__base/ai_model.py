import decimal
import os
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Optional

from pydantic import ConfigDict

from core.helper.position_helper import get_position_map, sort_by_position_map
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    ModelType,
    PriceConfig,
    PriceInfo,
    PriceType,
)
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.tools.utils.yaml_utils import load_yaml_file


class AIModel(ABC):
    """
    Base class for all models.
    """

    model_type: ModelType
    model_schemas: Optional[list[AIModelEntity]] = None
    started_at: float = 0

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @abstractmethod
    def validate_credentials(self, model: str, credentials: Mapping) -> None:
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
        provider_name = self.__class__.__module__.split('.')[-3]

        for invoke_error, model_errors in self._invoke_error_mapping.items():
            if isinstance(error, tuple(model_errors)):
                if invoke_error == InvokeAuthorizationError:
                    return invoke_error(description=f"[{provider_name}] Incorrect model credentials provided, please check and try again. ")

                return invoke_error(description=f"[{provider_name}] {invoke_error.description}, {str(error)}")

        return InvokeError(description=f"[{provider_name}] Error: {str(error)}")

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
        total_amount = total_amount.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

        return PriceInfo(
            unit_price=unit_price,
            unit=price_config.unit,
            total_amount=total_amount,
            currency=price_config.currency,
        )

    def predefined_models(self) -> list[AIModelEntity]:
        """
        Get all predefined models for given provider.

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
        position_map = get_position_map(provider_model_type_path)

        # traverse all model_schema_yaml_paths
        for model_schema_yaml_path in model_schema_yaml_paths:
            # read yaml data from yaml file
            yaml_data = load_yaml_file(model_schema_yaml_path)

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

            try:
                # yaml_data to entity
                model_schema = AIModelEntity(**yaml_data)
            except Exception as e:
                model_schema_yaml_file_name = os.path.basename(model_schema_yaml_path).rstrip(".yaml")
                raise Exception(f'Invalid model schema for {provider_name}.{model_type}.{model_schema_yaml_file_name}:'
                                f' {str(e)}')

            # cache model schema
            model_schemas.append(model_schema)

        # resort model schemas by position
        model_schemas = sort_by_position_map(position_map, model_schemas, lambda x: x.model)

        # cache model schemas
        self.model_schemas = model_schemas

        return model_schemas

    def get_model_schema(self, model: str, credentials: Optional[Mapping] = None) -> Optional[AIModelEntity]:
        """
        Get model schema by model name and credentials

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        # get predefined models (predefined_models)
        models = self.predefined_models()

        model_map = {model.model: model for model in models}
        if model in model_map:
            return model_map[model]

        if credentials:
            model_schema = self.get_customizable_model_schema_from_credentials(model, credentials)
            if model_schema:
                return model_schema

        return None

    def get_customizable_model_schema_from_credentials(self, model: str, credentials: Mapping) -> Optional[AIModelEntity]:
        """
        Get customizable model schema from credentials

        :param model: model name
        :param credentials: model credentials
        :return: model schema
        """
        return self._get_customizable_model_schema(model, credentials)

    def _get_customizable_model_schema(self, model: str, credentials: Mapping) -> Optional[AIModelEntity]:
        """
        Get customizable model schema and fill in the template
        """
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
                    if not parameter_rule.max and 'max' in default_parameter_rule:
                        parameter_rule.max = default_parameter_rule['max']
                    if not parameter_rule.min and 'min' in default_parameter_rule:
                        parameter_rule.min = default_parameter_rule['min']
                    if not parameter_rule.default and 'default' in default_parameter_rule:
                        parameter_rule.default = default_parameter_rule['default']
                    if not parameter_rule.precision and 'precision' in default_parameter_rule:
                        parameter_rule.precision = default_parameter_rule['precision']
                    if not parameter_rule.required and 'required' in default_parameter_rule:
                        parameter_rule.required = default_parameter_rule['required']
                    if not parameter_rule.help and 'help' in default_parameter_rule:
                        parameter_rule.help = I18nObject(
                            en_US=default_parameter_rule['help']['en_US'],
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

    def get_customizable_model_schema(self, model: str, credentials: Mapping) -> Optional[AIModelEntity]:
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
