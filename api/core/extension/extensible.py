import enum
import importlib.util
import json
import logging
import os
from typing import Any, Optional

from pydantic import BaseModel

from core.utils.position_helper import sort_to_dict_by_position_map


class ExtensionModule(enum.Enum):
    MODERATION = 'moderation'
    EXTERNAL_DATA_TOOL = 'external_data_tool'


class ModuleExtension(BaseModel):
    extension_class: Any
    name: str
    label: Optional[dict] = None
    form_schema: Optional[list] = None
    builtin: bool = True
    position: Optional[int] = None


class Extensible:
    module: ExtensionModule

    name: str
    tenant_id: str
    config: Optional[dict] = None

    def __init__(self, tenant_id: str, config: Optional[dict] = None) -> None:
        self.tenant_id = tenant_id
        self.config = config

    @classmethod
    def scan_extensions(cls):
        extensions: list[ModuleExtension] = []
        position_map = {}

        # get the path of the current class
        current_path = os.path.abspath(cls.__module__.replace(".", os.path.sep) + '.py')
        current_dir_path = os.path.dirname(current_path)

        # traverse subdirectories
        for subdir_name in os.listdir(current_dir_path):
            if subdir_name.startswith('__'):
                continue

            subdir_path = os.path.join(current_dir_path, subdir_name)
            extension_name = subdir_name
            if os.path.isdir(subdir_path):
                file_names = os.listdir(subdir_path)

                # is builtin extension, builtin extension
                # in the front-end page and business logic, there are special treatments.
                builtin = False
                position = None
                if '__builtin__' in file_names:
                    builtin = True

                    builtin_file_path = os.path.join(subdir_path, '__builtin__')
                    if os.path.exists(builtin_file_path):
                        with open(builtin_file_path, encoding='utf-8') as f:
                            position = int(f.read().strip())
                position_map[extension_name] = position

                if (extension_name + '.py') not in file_names:
                    logging.warning(f"Missing {extension_name}.py file in {subdir_path}, Skip.")
                    continue

                # Dynamic loading {subdir_name}.py file and find the subclass of Extensible
                py_path = os.path.join(subdir_path, extension_name + '.py')
                spec = importlib.util.spec_from_file_location(extension_name, py_path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                extension_class = None
                for name, obj in vars(mod).items():
                    if isinstance(obj, type) and issubclass(obj, cls) and obj != cls:
                        extension_class = obj
                        break

                if not extension_class:
                    logging.warning(f"Missing subclass of {cls.__name__} in {py_path}, Skip.")
                    continue

                json_data = {}
                if not builtin:
                    if 'schema.json' not in file_names:
                        logging.warning(f"Missing schema.json file in {subdir_path}, Skip.")
                        continue

                    json_path = os.path.join(subdir_path, 'schema.json')
                    json_data = {}
                    if os.path.exists(json_path):
                        with open(json_path, encoding='utf-8') as f:
                            json_data = json.load(f)

                extensions.append(ModuleExtension(
                    extension_class=extension_class,
                    name=extension_name,
                    label=json_data.get('label'),
                    form_schema=json_data.get('form_schema'),
                    builtin=builtin,
                    position=position
                ))

        sorted_extensions = sort_to_dict_by_position_map(position_map, extensions, lambda x: x.name)

        return sorted_extensions
