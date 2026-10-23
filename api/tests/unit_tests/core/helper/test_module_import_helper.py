from pathlib import Path

from core.helper.module_import_helper import import_module_from_source, load_single_subclass_from_source
from tests.helpers.unit.utils.module_import_fixtures.parent_class import ParentClass

FIXTURE_DIR = Path(__file__).parents[3] / "helpers" / "unit" / "utils" / "module_import_fixtures"


def test_loading_subclass_from_source() -> None:
    module = load_single_subclass_from_source(
        module_name="ChildClass", script_path=str(FIXTURE_DIR / "child_class.py"), parent_type=ParentClass
    )
    assert module
    assert module.__name__ == "ChildClass"


def test_load_import_module_from_source() -> None:
    module = import_module_from_source(module_name="ChildClass", py_file_path=str(FIXTURE_DIR / "child_class.py"))
    assert module
    assert module.__name__ == "ChildClass"


def test_lazy_loading_subclass_from_source() -> None:
    clz = load_single_subclass_from_source(
        module_name="LazyLoadChildClass",
        script_path=str(FIXTURE_DIR / "lazy_load_class.py"),
        parent_type=ParentClass,
        use_lazy_loader=True,
    )
    instance = clz("dify")
    assert instance.get_name() == "dify"
