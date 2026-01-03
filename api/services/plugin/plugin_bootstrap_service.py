import logging

from configs import dify_config
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginVerification
from core.plugin.impl.plugin import PluginInstaller
from services.feature_service import FeatureService, PluginInstallationScope

logger = logging.getLogger(__name__)


class PluginBootstrapService:
    @staticmethod
    def install_default_plugins(tenant_id: str) -> None:
        """
        Auto-install configured plugins for a newly created tenant.

        This is best-effort and must never block tenant creation.
        """
        identifiers = dify_config.DEFAULT_TENANT_PLUGIN_UNIQUE_IDENTIFIERS
        if not identifiers:
            return

        features = FeatureService.get_system_features()
        if features.plugin_installation_permission.restrict_to_marketplace_only:
            logger.info(
                "Skip default plugin install because plugin installation is restricted. tenant_id=%s", tenant_id
            )
            return

        manager = PluginInstaller()

        try:
            installed = manager.list_plugins(tenant_id)
            installed_identifiers = {p.plugin_unique_identifier for p in installed}
        except Exception:
            logger.exception("Failed to list installed plugins, continue with empty set. tenant_id=%s", tenant_id)
            installed_identifiers = set()

        to_install: list[str] = []
        metas: list[dict] = []

        for identifier in identifiers:
            if not identifier or identifier in installed_identifiers:
                continue

            try:
                decoded = manager.decode_plugin_from_identifier(tenant_id, identifier)
                match features.plugin_installation_permission.plugin_installation_scope:
                    case PluginInstallationScope.OFFICIAL_ONLY:
                        if (
                            decoded.verification is None
                            or decoded.verification.authorized_category
                            != PluginVerification.AuthorizedCategory.Langgenius
                        ):
                            raise ValueError("default plugin is restricted to official only")
                    case PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS:
                        if decoded.verification is None or decoded.verification.authorized_category not in [
                            PluginVerification.AuthorizedCategory.Langgenius,
                            PluginVerification.AuthorizedCategory.Partner,
                        ]:
                            raise ValueError("default plugin is restricted to official and specific partners")
                    case PluginInstallationScope.NONE:
                        raise ValueError("default plugin installation is not allowed")
                    case PluginInstallationScope.ALL:
                        pass

                canonical_identifier = decoded.unique_identifier
                if canonical_identifier in installed_identifiers or canonical_identifier in to_install:
                    continue

                to_install.append(canonical_identifier)
                metas.append({"plugin_unique_identifier": canonical_identifier})
            except Exception:
                logger.exception(
                    "Skip default plugin install due to decode/scope error. tenant_id=%s identifier=%s",
                    tenant_id,
                    identifier,
                )

        if not to_install:
            return

        try:
            manager.install_from_identifiers(
                tenant_id=tenant_id,
                identifiers=to_install,
                source=PluginInstallationSource.Package,
                metas=metas,
            )
        except Exception:
            logger.exception(
                "Failed to start default plugin installation task. tenant_id=%s identifiers=%s",
                tenant_id,
                to_install,
            )
