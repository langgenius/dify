import os

from core.utils.module_import_helper import load_single_subclass_from_source, import_module_from_source
from tests.integration_tests.utils.parent_class import ParentClass


def test_loading_subclass_from_source():
    current_path = os.getcwd()
    module = load_single_subclass_from_source('ChildClass', os.path.join(current_path, 'child_class.py'), ParentClass)
    assert module and module.__name__ == 'ChildClass'


def test_load_import_module_from_source():
    current_path = os.getcwd()
    module = import_module_from_source('ChildClass', os.path.join(current_path, 'child_class.py'))
    assert module and module.__name__ == 'ChildClass'
