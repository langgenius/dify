from pathlib import Path


def search_file_upwards(
    base_dir_path: Path,
    target_file_name: str,
    max_search_parent_depth: int,
) -> Path:
    """
    Find a target file in the current directory or its parent directories up to a specified depth.
    :param base_dir_path: Starting directory path to search from.
    :param target_file_name: Name of the file to search for.
    :param max_search_parent_depth: Maximum number of parent directories to search upwards.
    :return: Path of the file if found, otherwise None.
    """
    current_path = base_dir_path.resolve()
    for _ in range(max_search_parent_depth):
        candidate_path = current_path / target_file_name
        if candidate_path.is_file():
            return candidate_path
        parent_path = current_path.parent
        if parent_path == current_path:  # reached the root directory
            break
        else:
            current_path = parent_path

    raise ValueError(
        f"File '{target_file_name}' not found in the directory '{base_dir_path.resolve()}' or its parent directories"
        f" in depth of {max_search_parent_depth}."
    )
