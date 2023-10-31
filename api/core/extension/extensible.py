import enum
import importlib.util
import json
import logging
import os
from typing import Any

from pydantic import BaseModel


class ExtensionModule(enum.Enum):
    MODERATION = 'moderation'
    EXTERNAL_DATA_TOOL = 'external_data_tool'


class ModuleExtension(BaseModel):
    extension_class: Any
    name: str
    label: dict = {}
    form_schema: list = []
    builtin: bool = True


class Extensible:
    @classmethod
    def scan_extensions(cls):
        extensions = {}

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
                if '__builtin__' in file_names:
                    builtin = True

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
                        builtin = False
                        with open(json_path, 'r') as f:
                            json_data = json.load(f)

                extensions[extension_name] = ModuleExtension(
                    extension_class=extension_class,
                    name=extension_name,
                    label=json_data.get('label', {}),
                    form_schema=json_data.get('form_schema', []),
                    builtin=builtin
                )

        return extensions
