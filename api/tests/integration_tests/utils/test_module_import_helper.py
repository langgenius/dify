import os

from core.helper.module_import_helper import import_module_from_source, load_single_subclass_from_source
from tests.integration_tests.utils.parent_class import ParentClass


def test_loading_subclass_from_source():
    current_path = os.getcwd()
    module = load_single_subclass_from_source(
        module_name="ChildClass", script_path=os.path.join(current_path, "child_class.py"), parent_type=ParentClass
    )
    assert module
    assert module.__name__ == "ChildClass"


def test_load_import_module_from_source():
    current_path = os.getcwd()
    module = import_module_from_source(
        module_name="ChildClass", py_file_path=os.path.join(current_path, "child_class.py")
    )
    assert module
    assert module.__name__ == "ChildClass"


def test_lazy_loading_subclass_from_source():
    current_path = os.getcwd()
    clz = load_single_subclass_from_source(
        module_name="LazyLoadChildClass",
        script_path=os.path.join(current_path, "lazy_load_class.py"),
        parent_type=ParentClass,
        use_lazy_loader=True,
    )
    instance = clz("dify")
    assert instance.get_name() == "dify"
