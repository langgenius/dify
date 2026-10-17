import pytest

from services.errors.plugin import PluginInstallationForbiddenError
from services.plugin.plugin_compatibility_service import PluginCompatibilityService


class TestCheckMinimumDifyVersion:
    def test_allows_plugin_without_minimum_version(self) -> None:
        PluginCompatibilityService.check_minimum_dify_version(None, "not-a-version")

    @pytest.mark.parametrize(
        ("minimum_dify_version", "current_dify_version"),
        [("1.16.0", "1.17.1"), ("1.17.1", "1.17.1")],
    )
    def test_allows_compatible_plugin(self, minimum_dify_version: str, current_dify_version: str) -> None:
        PluginCompatibilityService.check_minimum_dify_version(minimum_dify_version, current_dify_version)

    def test_rejects_plugin_that_requires_a_newer_dify_version(self) -> None:
        with pytest.raises(
            PluginInstallationForbiddenError, match=r"requires Dify >= 1\.18\.0.*current version is 1\.17\.1"
        ):
            PluginCompatibilityService.check_minimum_dify_version("1.18.0", "1.17.1")

    def test_rejects_when_host_version_cannot_be_compared(self) -> None:
        with pytest.raises(PluginInstallationForbiddenError, match="Cannot verify plugin compatibility"):
            PluginCompatibilityService.check_minimum_dify_version("1.18.0", "custom-build")
