import os
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from configs import dify_config
from core.tools.utils.yaml_utils import load_yaml_file


def get_position_map(folder_path: str, *, file_name: str = "_position.yaml") -> dict[str, int]:
    """
    Get the mapping from name to index from a YAML file
    :param folder_path:
    :param file_name: the YAML file name, default to '_position.yaml'
    :return: a dict with name as key and index as value
    """
    position_file_path = os.path.join(folder_path, file_name)
    yaml_content = load_yaml_file(file_path=position_file_path, default_value=[])
    positions = [item.strip() for item in yaml_content if item and isinstance(item, str) and item.strip()]
    return {name: index for index, name in enumerate(positions)}


def get_tool_position_map(folder_path: str, file_name: str = "_position.yaml") -> dict[str, int]:
    """
    Get the mapping for tools from name to index from a YAML file.
    :param folder_path:
    :param file_name: the YAML file name, default to '_position.yaml'
    :return: a dict with name as key and index as value
    """
    position_map = get_position_map(folder_path, file_name=file_name)

    return pin_position_map(
        position_map,
        pin_list=dify_config.POSITION_TOOL_PINS_LIST,
    )


def get_provider_position_map(folder_path: str, file_name: str = "_position.yaml") -> dict[str, int]:
    """
    Get the mapping for providers from name to index from a YAML file.
    :param folder_path:
    :param file_name: the YAML file name, default to '_position.yaml'
    :return: a dict with name as key and index as value
    """
    position_map = get_position_map(folder_path, file_name=file_name)
    return pin_position_map(
        position_map,
        pin_list=dify_config.POSITION_PROVIDER_PINS_LIST,
    )


def pin_position_map(original_position_map: dict[str, int], pin_list: list[str]) -> dict[str, int]:
    """
    Pin the items in the pin list to the beginning of the position map.
    Overall logic: exclude > include > pin
    :param position_map: the position map to be sorted and filtered
    :param pin_list: the list of pins to be put at the beginning
    :return: the sorted position map
    """
    positions = sorted(original_position_map.keys(), key=lambda x: original_position_map[x])

    # Add pins to position map
    position_map = {name: idx for idx, name in enumerate(pin_list)}

    # Add remaining positions to position map
    start_idx = len(position_map)
    for name in positions:
        if name not in position_map:
            position_map[name] = start_idx
            start_idx += 1

    return position_map


def is_filtered(
    include_set: set[str],
    exclude_set: set[str],
    data: Any,
    name_func: Callable[[Any], str],
) -> bool:
    """
    Check if the object should be filtered out.
    Overall logic: exclude > include > pin
    :param include_set: the set of names to be included
    :param exclude_set: the set of names to be excluded
    :param name_func: the function to get the name of the object
    :param data: the data to be filtered
    :return: True if the object should be filtered out, False otherwise
    """
    if not data:
        return False
    if not include_set and not exclude_set:
        return False

    name = name_func(data)

    if name in exclude_set:  # exclude_set is prioritized
        return True
    if include_set and name not in include_set:  # filter out only if include_set is not empty
        return True
    return False


def sort_by_position_map(
    position_map: dict[str, int],
    data: list[Any],
    name_func: Callable[[Any], str],
) -> list[Any]:
    """
    Sort the objects by the position map.
    If the name of the object is not in the position map, it will be put at the end.
    :param position_map: the map holding positions in the form of {name: index}
    :param name_func: the function to get the name of the object
    :param data: the data to be sorted
    :return: the sorted objects
    """
    if not position_map or not data:
        return data

    return sorted(data, key=lambda x: position_map.get(name_func(x), float("inf")))


def sort_to_dict_by_position_map(
    position_map: dict[str, int],
    data: list[Any],
    name_func: Callable[[Any], str],
) -> OrderedDict[str, Any]:
    """
    Sort the objects into a ordered dict by the position map.
    If the name of the object is not in the position map, it will be put at the end.
    :param position_map: the map holding positions in the form of {name: index}
    :param name_func: the function to get the name of the object
    :param data: the data to be sorted
    :return: an OrderedDict with the sorted pairs of name and object
    """
    sorted_items = sort_by_position_map(position_map, data, name_func)
    return OrderedDict([(name_func(item), item) for item in sorted_items])
