import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from yaml import YAMLError

logger = logging.getLogger(__name__)


def _load_yaml_file(*, file_path: str):
    if not file_path or not Path(file_path).exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    with open(file_path, encoding="utf-8") as yaml_file:
        try:
            yaml_content = yaml.safe_load(yaml_file)
            return yaml_content
        except Exception as e:
            raise YAMLError(f"Failed to load YAML file {file_path}: {e}") from e


@lru_cache(maxsize=128)
def load_yaml_file_cached(file_path: str) -> Any:
    """
    Cached version of load_yaml_file for static configuration files.
    Only use for files that don't change during runtime (e.g., position files)

    :param file_path: the path of the YAML file
    :return: an object of the YAML content
    """
    return _load_yaml_file(file_path=file_path)
