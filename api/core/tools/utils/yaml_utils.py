import logging
import os

import yaml
from yaml import YAMLError

logger = logging.getLogger(__name__)

def load_yaml_file(file_path: str, ignore_error: bool = False) -> dict:
    """
    Safe loading a YAML file to a dict
    :param file_path: the path of the YAML file
    :param ignore_error:
        if True, return empty dict if error occurs and the error will be logged in warning level
        if False, raise error if error occurs
    :return: a dict of the YAML content
    """
    try:
        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f'Failed to load YAML file {file_path}: file not found')

        with open(file_path, encoding='utf-8') as file:
            try:
                return yaml.safe_load(file)
            except Exception as e:
                raise YAMLError(f'Failed to load YAML file {file_path}: {e}')
    except FileNotFoundError as e:
        logger.debug(f'Failed to load YAML file {file_path}: {e}')
        return {}
    except Exception as e:
        if ignore_error:
            logger.warning(f'Failed to load YAML file {file_path}: {e}')
            return {}
        else:
            raise e
