"""Validate plugin manifests against the Dify version that will install them."""

from packaging.version import InvalidVersion, Version

from services.errors.plugin import PluginInstallationForbiddenError


class PluginCompatibilityService:
    @staticmethod
    def check_minimum_dify_version(minimum_dify_version: str | None, current_dify_version: str) -> None:
        """Reject a plugin that requires a newer host, or when the host cannot be compared safely."""
        if minimum_dify_version is None:
            return

        try:
            current_version = Version(current_dify_version)
            minimum_version = Version(minimum_dify_version)
        except InvalidVersion as error:
            raise PluginInstallationForbiddenError(
                f"Cannot verify plugin compatibility because the Dify version is invalid: {error}"
            ) from error

        if minimum_version > current_version:
            raise PluginInstallationForbiddenError(
                f"This plugin requires Dify >= {minimum_version}; the current version is {current_version}."
            )
