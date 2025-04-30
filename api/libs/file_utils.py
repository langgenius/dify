import os
from pathlib import Path
from typing import Optional


def search_file_upwards(
    base_dir_path: str = os.path.dirname(Path(__file__)),
    target_file_name: str = "pyproject.toml",
    max_search_parent_depth: int = 1,
) -> Optional[str]:
    """
    Find a target file in the current directory or its parent directories up to a specified depth.
    :param base_dir_path: Starting directory path to search from.
    :param target_file_name: Name of the file to search for.
    :param max_search_parent_depth: Maximum number of parent directories to search upwards.
    :return: Path of the file if found, otherwise None.
    """
    current_dir = base_dir_path
    for level in range(max_search_parent_depth):
        candidate = os.path.join(current_dir, target_file_name)
        if os.path.isfile(candidate):
            return candidate
        parent_dir = os.path.dirname(current_dir)
        if parent_dir == current_dir:
            break
        current_dir = parent_dir
    return None
