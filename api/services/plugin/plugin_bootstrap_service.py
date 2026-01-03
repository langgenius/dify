import logging

from configs import dify_config
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginVerification
from core.plugin.impl.plugin import PluginInstaller
from services.feature_service import FeatureService, PluginInstallationScope
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


class PluginBootstrapService:
    @staticmethod
    def install_default_plugins(tenant_id: str) -> None:
        """
        Auto-install configured plugins for a newly created tenant.

        This is best-effort and must never block tenant creation.
        """
        identifiers = dify_config.DEFAULT_TENANT_PLUGIN_UNIQUE_IDENTIFIERS
        github_plugins = dify_config.DEFAULT_TENANT_GITHUB_PLUGINS
        if not identifiers and not github_plugins:
            return

        logger.info(
            "Default plugin auto-install triggered. tenant_id=%s identifiers=%s github_items=%s",
            tenant_id,
            len(identifiers),
            len(github_plugins),
        )

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

        if identifiers:
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

        if to_install:
            try:
                logger.info(
                    "Starting default plugin installation task from identifiers. tenant_id=%s count=%s",
                    tenant_id,
                    len(to_install),
                )
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

        if not github_plugins:
            github_plugins = []

        for item in github_plugins:
            try:
                logger.info(
                    "Auto-install default GitHub plugin configured item. tenant_id=%s repo=%s version=%s package=%s",
                    tenant_id,
                    item.repo,
                    item.version,
                    item.package,
                )
                if item.plugin_unique_identifier and item.plugin_unique_identifier in installed_identifiers:
                    continue

                # Fast path: install directly if the identifier is already available in plugin-daemon.
                if item.plugin_unique_identifier:
                    try:
                        PluginService.install_from_local_pkg(tenant_id, [item.plugin_unique_identifier])
                        installed_identifiers.add(item.plugin_unique_identifier)
                        logger.info(
                            "Auto-install GitHub plugin done via existing identifier. tenant_id=%s identifier=%s",
                            tenant_id,
                            item.plugin_unique_identifier,
                        )
                        continue
                    except Exception:
                        logger.info(
                            "Default GitHub plugin identifier not available, fallback to download. "
                            "tenant_id=%s repo=%s",
                            tenant_id,
                            item.repo,
                        )

                decoded = PluginService.upload_pkg_from_github(
                    tenant_id=tenant_id,
                    repo=item.repo,
                    version=item.version,
                    package=item.package,
                )
                PluginService.install_from_local_pkg(tenant_id, [decoded.unique_identifier])
                installed_identifiers.add(decoded.unique_identifier)
                logger.info(
                    "Auto-install GitHub plugin done. tenant_id=%s repo=%s identifier=%s",
                    tenant_id,
                    item.repo,
                    decoded.unique_identifier,
                )
            except Exception:
                logger.exception(
                    "Failed to auto-install default GitHub plugin. tenant_id=%s repo=%s version=%s package=%s",
                    tenant_id,
                    item.repo,
                    item.version,
                    item.package,
                )
