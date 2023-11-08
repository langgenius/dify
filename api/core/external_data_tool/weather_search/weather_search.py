from typing import Optional

from core.external_data_tool.base import ExternalDataTool


class WeatherSearch(ExternalDataTool):
    """
    The name of custom type must be unique, keep the same with directory and file name.
    """
    name: str = "weather_search"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        schema.json validation. It will be called when user save the config.

        Example:
            .. code-block:: python
                config = {
                    "temperature_unit": "centigrade"
                }

        :param tenant_id: the id of workspace
        :param config: the variables of form config
        :return:
        """

        if not config.get('temperature_unit'):
            raise ValueError('temperature unit is required')

    def query(self, inputs: dict, query: Optional[str] = None) -> str:
        """
        Query the external data tool.

        :param inputs: user inputs
        :param query: the query of chat app
        :return: the tool query result
        """
        city = inputs.get('city')
        temperature_unit = self.config.get('temperature_unit')

        if temperature_unit == 'fahrenheit':
            return f'Weather in {city} is 32°F'
        else:
            return f'Weather in {city} is 0°C'
