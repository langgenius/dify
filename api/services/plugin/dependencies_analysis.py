from configs import dify_config
from core.helper import marketplace
from core.plugin.entities.plugin import ModelProviderID, PluginDependency, PluginInstallationSource, ToolProviderID
from core.plugin.impl.plugin import PluginInstaller


class DependenciesAnalysisService:
    @classmethod
    def analyze_tool_dependency(cls, tool_id: str) -> str:
        """
        Analyze the dependency of a tool.

        Convert the tool id to the plugin_id
        """
        try:
            return ToolProviderID(tool_id).plugin_id
        except Exception as e:
            raise e

    @classmethod
    def analyze_model_provider_dependency(cls, model_provider_id: str) -> str:
        """
        Analyze the dependency of a model provider.

        Convert the model provider id to the plugin_id
        """
        try:
            return ModelProviderID(model_provider_id).plugin_id
        except Exception as e:
            raise e

    @classmethod
    def get_leaked_dependencies(cls, tenant_id: str, dependencies: list[PluginDependency]) -> list[PluginDependency]:
        """
        Check dependencies, returns the leaked dependencies in current workspace
        """
        required_plugin_unique_identifiers = []
        for dependency in dependencies:
            required_plugin_unique_identifiers.append(dependency.value.plugin_unique_identifier)

        manager = PluginInstaller()

        # get leaked dependencies
        missing_plugins = manager.fetch_missing_dependencies(tenant_id, required_plugin_unique_identifiers)
        missing_plugin_unique_identifiers = {plugin.plugin_unique_identifier: plugin for plugin in missing_plugins}

        leaked_dependencies = []
        for dependency in dependencies:
            unique_identifier = dependency.value.plugin_unique_identifier
            if unique_identifier in missing_plugin_unique_identifiers:
                leaked_dependencies.append(
                    PluginDependency(
                        type=dependency.type,
                        value=dependency.value,
                        current_identifier=missing_plugin_unique_identifiers[unique_identifier].current_identifier,
                    )
                )

        return leaked_dependencies

    @classmethod
    def generate_dependencies(cls, tenant_id: str, dependencies: list[str]) -> list[PluginDependency]:
        """
        Generate dependencies through the list of plugin ids
        """
        dependencies = list(set(dependencies))
        manager = PluginInstaller()
        plugins = manager.fetch_plugin_installation_by_ids(tenant_id, dependencies)
        result = []
        for plugin in plugins:
            if plugin.source == PluginInstallationSource.Github:
                result.append(
                    PluginDependency(
                        type=PluginDependency.Type.Github,
                        value=PluginDependency.Github(
                            repo=plugin.meta["repo"],
                            version=plugin.meta["version"],
                            package=plugin.meta["package"],
                            github_plugin_unique_identifier=plugin.plugin_unique_identifier,
                        ),
                    )
                )
            elif plugin.source == PluginInstallationSource.Marketplace:
                result.append(
                    PluginDependency(
                        type=PluginDependency.Type.Marketplace,
                        value=PluginDependency.Marketplace(
                            marketplace_plugin_unique_identifier=plugin.plugin_unique_identifier
                        ),
                    )
                )
            elif plugin.source == PluginInstallationSource.Package:
                result.append(
                    PluginDependency(
                        type=PluginDependency.Type.Package,
                        value=PluginDependency.Package(plugin_unique_identifier=plugin.plugin_unique_identifier),
                    )
                )
            elif plugin.source == PluginInstallationSource.Remote:
                raise ValueError(
                    f"You used a remote plugin: {plugin.plugin_unique_identifier} in the app, please remove it first"
                    " if you want to export the DSL."
                )
            else:
                raise ValueError(f"Unknown plugin source: {plugin.source}")

        return result

    @classmethod
    def generate_latest_dependencies(cls, dependencies: list[str]) -> list[PluginDependency]:
        """
        Generate the latest version of dependencies
        """
        dependencies = list(set(dependencies))
        if not dify_config.MARKETPLACE_ENABLED:
            return []
        deps = marketplace.batch_fetch_plugin_manifests(dependencies)
        return [
            PluginDependency(
                type=PluginDependency.Type.Marketplace,
                value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier=dep.latest_package_identifier),
            )
            for dep in deps
        ]
