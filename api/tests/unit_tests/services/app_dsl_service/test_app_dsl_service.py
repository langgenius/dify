import pytest
from packaging import version

from services.app_dsl_service.exc import DSLVersionNotSupportedError
from services.app_dsl_service.service import CURRENT_DSL_VERSION, _check_or_fix_dsl


class TestAppDSLService:
    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_missing_version(self):
        import_data = {}
        result = _check_or_fix_dsl(import_data)
        assert result["version"] == "0.1.0"
        assert result["kind"] == "app"

    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_missing_kind(self):
        import_data = {"version": "0.1.0"}
        result = _check_or_fix_dsl(import_data)
        assert result["kind"] == "app"

    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_older_version(self):
        import_data = {"version": "0.0.9", "kind": "app"}
        result = _check_or_fix_dsl(import_data)
        assert result["version"] == "0.0.9"

    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_current_version(self):
        import_data = {"version": CURRENT_DSL_VERSION, "kind": "app"}
        result = _check_or_fix_dsl(import_data)
        assert result["version"] == CURRENT_DSL_VERSION

    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_newer_version(self):
        current_version = version.parse(CURRENT_DSL_VERSION)
        newer_version = f"{current_version.major}.{current_version.minor + 1}.0"
        import_data = {"version": newer_version, "kind": "app"}
        with pytest.raises(DSLVersionNotSupportedError):
            _check_or_fix_dsl(import_data)

    @pytest.mark.skip(reason="Test skipped")
    def test_check_or_fix_dsl_invalid_kind(self):
        import_data = {"version": CURRENT_DSL_VERSION, "kind": "invalid"}
        result = _check_or_fix_dsl(import_data)
        assert result["kind"] == "app"
