import importlib.util
import json
import logging
import os
from enum import StrEnum, auto
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from core.helper.position_helper import sort_to_dict_by_position_map

logger = logging.getLogger(__name__)


class ExtensionModule(StrEnum):
    MODERATION = auto()
    EXTERNAL_DATA_TOOL = auto()


class ModuleExtension(BaseModel):
    extension_class: Any | None = None
    name: str
    label: dict | None = None
    form_schema: list | None = None
    builtin: bool = True
    position: int | None = None


class Extensible:
    module: ExtensionModule

    name: str
    tenant_id: str
    config: dict | None = None

    def __init__(self, tenant_id: str, config: dict | None = None):
        self.tenant_id = tenant_id
        self.config = config

    @classmethod
    def scan_extensions(cls):
        extensions = []
        position_map: dict[str, int] = {}

        # Get the package name from the module path
        package_name = ".".join(cls.__module__.split(".")[:-1])

        try:
            # Get package directory path
            package_spec = importlib.util.find_spec(package_name)
            if not package_spec or not package_spec.origin:
                raise ImportError(f"Could not find package {package_name}")

            package_dir = os.path.dirname(package_spec.origin)

            # Traverse subdirectories
            for subdir_name in os.listdir(package_dir):
                if subdir_name.startswith("__"):
                    continue

                subdir_path = os.path.join(package_dir, subdir_name)
                if not os.path.isdir(subdir_path):
                    continue

                extension_name = subdir_name
                file_names = os.listdir(subdir_path)

                # Check for extension module file
                if (extension_name + ".py") not in file_names:
                    logger.warning("Missing %s.py file in %s, Skip.", extension_name, subdir_path)
                    continue

                # Check for builtin flag and position
                builtin = False
                position = 0
                if "__builtin__" in file_names:
                    builtin = True
                    builtin_file_path = os.path.join(subdir_path, "__builtin__")
                    if os.path.exists(builtin_file_path):
                        position = int(Path(builtin_file_path).read_text(encoding="utf-8").strip())
                    position_map[extension_name] = position

                # Import the extension module
                module_name = f"{package_name}.{extension_name}.{extension_name}"
                spec = importlib.util.find_spec(module_name)
                if not spec or not spec.loader:
                    raise ImportError(f"Failed to load module {module_name}")
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                # Find extension class
                extension_class = None
                for obj in vars(mod).values():
                    if isinstance(obj, type) and issubclass(obj, cls) and obj != cls:
                        extension_class = obj
                        break

                if not extension_class:
                    logger.warning("Missing subclass of %s in %s, Skip.", cls.__name__, module_name)
                    continue

                # Load schema if not builtin
                json_data: dict[str, Any] = {}
                if not builtin:
                    json_path = os.path.join(subdir_path, "schema.json")
                    if not os.path.exists(json_path):
                        logger.warning("Missing schema.json file in %s, Skip.", subdir_path)
                        continue

                    with open(json_path, encoding="utf-8") as f:
                        json_data = json.load(f)

                # Create extension
                extensions.append(
                    ModuleExtension(
                        extension_class=extension_class,
                        name=extension_name,
                        label=json_data.get("label"),
                        form_schema=json_data.get("form_schema"),
                        builtin=builtin,
                        position=position,
                    )
                )

        except Exception:
            logger.exception("Error scanning extensions")
            raise

        # Sort extensions by position
        sorted_extensions = sort_to_dict_by_position_map(
            position_map=position_map, data=extensions, name_func=lambda x: x.name
        )

        return sorted_extensions
