import logging
from typing import Any

import yaml
from yaml import YAMLError

logger = logging.getLogger(__name__)


def load_yaml_file(file_path: str, ignore_error: bool = True, default_value: Any = {}) -> Any:
    """
    Safe loading a YAML file
    :param file_path: the path of the YAML file
    :param ignore_error:
        if True, return default_value if error occurs and the error will be logged in debug level
        if False, raise error if error occurs
    :param default_value: the value returned when errors ignored
    :return: an object of the YAML content
    """
    try:
        with open(file_path, encoding="utf-8") as yaml_file:
            try:
                yaml_content = yaml.safe_load(yaml_file)
                return yaml_content or default_value
            except Exception as e:
                raise YAMLError(f"Failed to load YAML file {file_path}: {e}")
    except Exception as e:
        if ignore_error:
            return default_value
        else:
            raise e
