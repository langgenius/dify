import json
import types
from unittest.mock import MagicMock, mock_open, patch

import pytest

from core.extension.extensible import Extensible


class TestExtensible:
    def test_init(self):
        tenant_id = "tenant_123"
        config = {"key": "value"}
        ext = Extensible(tenant_id, config)
        assert ext.tenant_id == tenant_id
        assert ext.config == config

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    @patch("core.extension.extensible.os.path.exists")
    @patch("core.extension.extensible.Path.read_text")
    @patch("core.extension.extensible.importlib.util.module_from_spec")
    @patch("core.extension.extensible.sort_to_dict_by_position_map")
    def test_scan_extensions_success(
        self,
        mock_sort,
        mock_module_from_spec,
        mock_read_text,
        mock_exists,
        mock_isdir,
        mock_listdir,
        mock_dirname,
        mock_find_spec,
    ):
        # Setup
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"

        module_spec = MagicMock()
        module_spec.loader = MagicMock()

        mock_find_spec.side_effect = [package_spec, module_spec]
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [
            ["ext1"],  # package_dir
            ["ext1.py", "__builtin__"],  # subdir_path
        ]
        mock_isdir.return_value = True

        mock_exists.return_value = True
        mock_read_text.return_value = "10"

        # Use types.ModuleType to avoid MagicMock __dict__ issues
        mock_mod = types.ModuleType("ext1")

        class MockExtension(Extensible):
            pass

        mock_mod.MockExtension = MockExtension
        mock_module_from_spec.return_value = mock_mod

        mock_sort.side_effect = lambda position_map, data, name_func: data

        # Execute
        results = Extensible.scan_extensions()

        # Assert
        assert len(results) == 1
        assert results[0].name == "ext1"
        assert results[0].position == 10
        assert results[0].builtin is True
        assert results[0].extension_class == MockExtension

    @patch("core.extension.extensible.importlib.util.find_spec")
    def test_scan_extensions_package_not_found(self, mock_find_spec):
        mock_find_spec.return_value = None
        with pytest.raises(ImportError, match="Could not find package"):
            Extensible.scan_extensions()

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    def test_scan_extensions_skip_subdirs(self, mock_isdir, mock_listdir, mock_dirname, mock_find_spec):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"
        mock_find_spec.return_value = package_spec
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [["__pycache__", "not_a_dir", "missing_py_file"], []]

        mock_isdir.side_effect = [False, True]

        with patch("core.extension.extensible.sort_to_dict_by_position_map", return_value=[]):
            results = Extensible.scan_extensions()
            assert len(results) == 0

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    @patch("core.extension.extensible.os.path.exists")
    @patch("core.extension.extensible.importlib.util.module_from_spec")
    def test_scan_extensions_not_builtin_success(
        self, mock_module_from_spec, mock_exists, mock_isdir, mock_listdir, mock_dirname, mock_find_spec
    ):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"

        module_spec = MagicMock()
        module_spec.loader = MagicMock()

        mock_find_spec.side_effect = [package_spec, module_spec]
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [["ext1"], ["ext1.py", "schema.json"]]
        mock_isdir.return_value = True

        # exists checks: only schema.json needs to exist
        mock_exists.return_value = True

        mock_mod = types.ModuleType("ext1")

        class MockExtension(Extensible):
            pass

        mock_mod.MockExtension = MockExtension
        mock_module_from_spec.return_value = mock_mod

        schema_content = json.dumps({"label": {"en": "Test"}, "form_schema": [{"name": "field1"}]})

        with (
            patch("builtins.open", mock_open(read_data=schema_content)),
            patch(
                "core.extension.extensible.sort_to_dict_by_position_map",
                side_effect=lambda position_map, data, name_func: data,
            ),
        ):
            results = Extensible.scan_extensions()

        assert len(results) == 1
        assert results[0].name == "ext1"
        assert results[0].builtin is False
        assert results[0].label == {"en": "Test"}

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    @patch("core.extension.extensible.os.path.exists")
    @patch("core.extension.extensible.importlib.util.module_from_spec")
    def test_scan_extensions_not_builtin_missing_schema(
        self, mock_module_from_spec, mock_exists, mock_isdir, mock_listdir, mock_dirname, mock_find_spec
    ):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"

        module_spec = MagicMock()
        module_spec.loader = MagicMock()

        mock_find_spec.side_effect = [package_spec, module_spec]
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [["ext1"], ["ext1.py"]]
        mock_isdir.return_value = True

        # exists: only schema.json checked, and return False
        mock_exists.return_value = False

        mock_mod = types.ModuleType("ext1")

        class MockExtension(Extensible):
            pass

        mock_mod.MockExtension = MockExtension
        mock_module_from_spec.return_value = mock_mod

        with patch("core.extension.extensible.sort_to_dict_by_position_map", return_value=[]):
            results = Extensible.scan_extensions()

        assert len(results) == 0

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    @patch("core.extension.extensible.importlib.util.module_from_spec")
    @patch("core.extension.extensible.os.path.exists")
    def test_scan_extensions_no_extension_class(
        self, mock_exists, mock_module_from_spec, mock_isdir, mock_listdir, mock_dirname, mock_find_spec
    ):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"
        module_spec = MagicMock()
        module_spec.loader = MagicMock()

        mock_find_spec.side_effect = [package_spec, module_spec]
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [["ext1"], ["ext1.py"]]
        mock_isdir.return_value = True

        # Mock not builtin
        mock_exists.return_value = False

        mock_mod = types.ModuleType("ext1")
        mock_mod.SomeOtherClass = type("SomeOtherClass", (), {})
        mock_module_from_spec.return_value = mock_mod

        # We need to ensure we don't crash if checking schema (but we won't reach there because class not found)

        with patch("core.extension.extensible.sort_to_dict_by_position_map", return_value=[]):
            results = Extensible.scan_extensions()

        assert len(results) == 0

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    def test_scan_extensions_module_import_error(self, mock_isdir, mock_listdir, mock_dirname, mock_find_spec):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"

        mock_find_spec.side_effect = [package_spec, None]  # No module spec
        mock_dirname.return_value = "/path/to/pkg"

        mock_listdir.side_effect = [["ext1"], ["ext1.py"]]
        mock_isdir.return_value = True

        with pytest.raises(ImportError, match="Failed to load module"):
            Extensible.scan_extensions()

    @patch("core.extension.extensible.importlib.util.find_spec")
    def test_scan_extensions_general_exception(self, mock_find_spec):
        mock_find_spec.side_effect = Exception("Unexpected error")
        with pytest.raises(Exception, match="Unexpected error"):
            Extensible.scan_extensions()

    @patch("core.extension.extensible.importlib.util.find_spec")
    @patch("core.extension.extensible.os.path.dirname")
    @patch("core.extension.extensible.os.listdir")
    @patch("core.extension.extensible.os.path.isdir")
    @patch("core.extension.extensible.os.path.exists")
    @patch("core.extension.extensible.Path.read_text")
    @patch("core.extension.extensible.importlib.util.module_from_spec")
    def test_scan_extensions_builtin_without_position_file(
        self, mock_module_from_spec, mock_read_text, mock_exists, mock_isdir, mock_listdir, mock_dirname, mock_find_spec
    ):
        package_spec = MagicMock()
        package_spec.origin = "/path/to/pkg/__init__.py"
        module_spec = MagicMock()
        module_spec.loader = MagicMock()

        mock_find_spec.side_effect = [package_spec, module_spec]
        mock_dirname.return_value = "/path/to/pkg"
        mock_listdir.side_effect = [["ext1"], ["ext1.py", "__builtin__"]]
        mock_isdir.return_value = True

        # builtin exists in listdir, but os.path.exists(builtin_file_path) returns False
        mock_exists.return_value = False

        mock_mod = types.ModuleType("ext1")

        class MockExtension(Extensible):
            pass

        mock_mod.MockExtension = MockExtension
        mock_module_from_spec.return_value = mock_mod

        with patch(
            "core.extension.extensible.sort_to_dict_by_position_map",
            side_effect=lambda position_map, data, name_func: data,
        ):
            results = Extensible.scan_extensions()

        assert len(results) == 1
        assert results[0].position == 0
