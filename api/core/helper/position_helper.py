import os
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from core.tools.utils.yaml_utils import load_yaml_file


def get_position_map(folder_path: str, *, file_name: str = "_position.yaml") -> dict[str, int]:
    """
    Get the mapping from name to index from a YAML file
    :param folder_path:
    :param file_name: the YAML file name, default to '_position.yaml'
    :return: a dict with name as key and index as value
    """
    position_file_name = os.path.join(folder_path, file_name)
    positions = load_yaml_file(position_file_name, ignore_error=True)
    position_map = {}
    index = 0
    for _, name in enumerate(positions):
        if name and isinstance(name, str):
            position_map[name.strip()] = index
            index += 1
    return position_map


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

    return sorted(data, key=lambda x: position_map.get(name_func(x), float('inf')))


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
