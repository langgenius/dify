"""Actual admitted installation service for legacy transport/adapter fixtures.

The tests using this helper exercise a non-activated workspace. New activated
SYSTEM admission is independently covered by its real application tests.
"""

from dataclasses import dataclass

from services.plugin.installation_gateway import LegacyPluginInstallationGateway
from services.plugin.installation_service import PluginInstallationService
from tests.unit_tests.services.test_model_billing_source_plugin_admission import service


def legacy_installations() -> PluginInstallationService:
    admission, _, _, _ = service(active=False)
    return PluginInstallationService(admission=admission, mutations=LegacyPluginInstallationGateway())


@dataclass(frozen=True, slots=True)
class InstallationServices:
    plugin_installations: PluginInstallationService
