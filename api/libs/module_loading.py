"""
Module loading utilities similar to Django's module_loading.

Reference implementation from Django:
https://github.com/django/django/blob/main/django/utils/module_loading.py
"""

import sys
from importlib import import_module


def cached_import(module_path: str, class_name: str):
    """
    Import a module and return the named attribute/class from it, with caching.

    Args:
        module_path: The module path to import from
        class_name: The attribute/class name to retrieve

    Returns:
        The imported attribute/class
    """
    if not (
        (module := sys.modules.get(module_path))
        and (spec := getattr(module, "__spec__", None))
        and getattr(spec, "_initializing", False) is False
    ):
        module = import_module(module_path)
    return getattr(module, class_name)


def import_string(dotted_path: str):
    """
    Import a dotted module path and return the attribute/class designated by
    the last name in the path. Raise ImportError if the import failed.

    Args:
        dotted_path: Full module path to the class (e.g., 'module.submodule.ClassName')

    Returns:
        The imported class or attribute

    Raises:
        ImportError: If the module or attribute cannot be imported
    """
    try:
        module_path, class_name = dotted_path.rsplit(".", 1)
    except ValueError as err:
        raise ImportError(f"{dotted_path} doesn't look like a module path") from err

    try:
        return cached_import(module_path, class_name)
    except AttributeError as err:
        raise ImportError(f'Module "{module_path}" does not define a "{class_name}" attribute/class') from err
