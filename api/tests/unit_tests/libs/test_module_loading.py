import math
import sys
import types
from unittest.mock import Mock

import pytest

from libs import module_loading


class TestCachedImport:
    def test_should_use_cached_module_when_available(self, monkeypatch):
        module_name = "tests.fake_module"
        attribute_name = "Sample"
        expected_value = object()

        cached_module = types.ModuleType(module_name)
        cached_module.__spec__ = types.SimpleNamespace(_initializing=False)
        setattr(cached_module, attribute_name, expected_value)

        monkeypatch.setitem(sys.modules, module_name, cached_module)
        import_mock = Mock(side_effect=AssertionError("import_module should not be called"))
        monkeypatch.setattr(module_loading, "import_module", import_mock)

        result = module_loading.cached_import(module_name, attribute_name)

        assert result is expected_value
        import_mock.assert_not_called()

    def test_should_import_when_module_initializing(self, monkeypatch):
        module_name = "tests.reloaded_module"
        attribute_name = "Value"
        expected_value = object()

        initializing_module = types.ModuleType(module_name)
        initializing_module.__spec__ = types.SimpleNamespace(_initializing=True)
        monkeypatch.setitem(sys.modules, module_name, initializing_module)

        loaded_module = types.ModuleType(module_name)
        loaded_module.__spec__ = types.SimpleNamespace(_initializing=False)
        setattr(loaded_module, attribute_name, expected_value)

        import_mock = Mock(return_value=loaded_module)
        monkeypatch.setattr(module_loading, "import_module", import_mock)

        result = module_loading.cached_import(module_name, attribute_name)

        assert result is expected_value
        import_mock.assert_called_once_with(module_name)


class TestImportString:
    def test_should_import_attribute_from_dotted_path(self):
        result = module_loading.import_string("math.pi")

        assert result == math.pi

    def test_should_raise_error_for_invalid_path(self):
        with pytest.raises(ImportError) as exc_info:
            module_loading.import_string("not_a_path")

        assert "doesn't look like a module path" in str(exc_info.value)

    def test_should_raise_error_when_attribute_missing(self):
        with pytest.raises(ImportError) as exc_info:
            module_loading.import_string("math.nonexistent_attribute")

        assert 'Module "math" does not define a "nonexistent_attribute" attribute/class' in str(exc_info.value)
