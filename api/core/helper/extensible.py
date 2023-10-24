import json
import os
import copy

class Extensible:
    __extensions = {}

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.register()

    @classmethod
    def register(cls):
        subclass_path = os.path.abspath(cls.__module__.replace(".", os.path.sep) + '.py')
        subclass_dir_path = os.path.dirname(subclass_path)
        parent_folder_name = os.path.basename(os.path.dirname(subclass_dir_path))

        json_path = os.path.join(subclass_dir_path, 'schema.json')
        json_data = {}
        if os.path.exists(json_path):
            with open(json_path, 'r') as f:
                json_data = json.load(f)        

        if parent_folder_name not in cls.__extensions:
            cls.__extensions[parent_folder_name] = {
                "module": parent_folder_name,
                "data": []
            }

        cls.__extensions[parent_folder_name]["data"].append(json_data)

    @classmethod
    def get_extensions(cls) -> dict:
        return copy.deepcopy(cls.__extensions)