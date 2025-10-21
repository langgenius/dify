import importlib.util
import logging
import sys
from types import ModuleType
from typing import AnyStr

logger = logging.getLogger(__name__)


def import_module_from_source(*, module_name: str, py_file_path: AnyStr, use_lazy_loader: bool = False) -> ModuleType:
    """
    Importing a module from the source file directly
    """
    try:
        existed_spec = importlib.util.find_spec(module_name)
        if existed_spec:
            spec = existed_spec
            if not spec.loader:
                raise Exception(f"Failed to load module {module_name} from {py_file_path!r}")
        else:
            # Refer to: https://docs.python.org/3/library/importlib.html#importing-a-source-file-directly
            # FIXME: mypy does not support the type of spec.loader
            spec = importlib.util.spec_from_file_location(module_name, py_file_path)  # type: ignore[assignment]
            if not spec or not spec.loader:
                raise Exception(f"Failed to load module {module_name} from {py_file_path!r}")
            if use_lazy_loader:
                # Refer to: https://docs.python.org/3/library/importlib.html#implementing-lazy-imports
                spec.loader = importlib.util.LazyLoader(spec.loader)
        module = importlib.util.module_from_spec(spec)
        if not existed_spec:
            sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    except Exception as e:
        logger.exception("Failed to load module %s from script file '%s'", module_name, repr(py_file_path))
        raise e


def get_subclasses_from_module(mod: ModuleType, parent_type: type) -> list[type]:
    """
    Get all the subclasses of the parent type from the module
    """
    classes = [
        x for _, x in vars(mod).items() if isinstance(x, type) and x != parent_type and issubclass(x, parent_type)
    ]
    return classes


def load_single_subclass_from_source(
    *, module_name: str, script_path: str, parent_type: type, use_lazy_loader: bool = False
) -> type:
    """
    Load a single subclass from the source
    """
    module = import_module_from_source(
        module_name=module_name, py_file_path=script_path, use_lazy_loader=use_lazy_loader
    )
    subclasses = get_subclasses_from_module(module, parent_type)
    match len(subclasses):
        case 1:
            return subclasses[0]
        case 0:
            raise Exception(f"Missing subclass of {parent_type.__name__} in {script_path!r}")
        case _:
            raise Exception(f"Multiple subclasses of {parent_type.__name__} in {script_path!r}")
