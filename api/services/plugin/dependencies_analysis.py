from core.plugin.entities.plugin import GenericProviderID, PluginDependency, PluginInstallationSource
from core.plugin.manager.plugin import PluginInstallationManager


class DependenciesAnalysisService:
    @classmethod
    def analyze_tool_dependency(cls, tool_id: str) -> str:
        """
        Analyze the dependency of a tool.

        Convert the tool id to the plugin_id
        """
        try:
            tool_provider_id = GenericProviderID(tool_id)
            return tool_provider_id.plugin_id
        except Exception as e:
            raise e

    @classmethod
    def analyze_model_provider_dependency(cls, model_provider_id: str) -> str:
        """
        Analyze the dependency of a model provider.

        Convert the model provider id to the plugin_id
        """
        try:
            generic_provider_id = GenericProviderID(model_provider_id)
            return generic_provider_id.plugin_id
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

        manager = PluginInstallationManager()
        missing_plugin_unique_identifiers = manager.fetch_missing_dependencies(
            tenant_id, required_plugin_unique_identifiers
        )

        leaked_dependencies = []
        for dependency in dependencies:
            unique_identifier = dependency.value.plugin_unique_identifier
            if unique_identifier in missing_plugin_unique_identifiers:
                leaked_dependencies.append(dependency)

        return leaked_dependencies

    @classmethod
    def generate_dependencies(cls, tenant_id: str, dependencies: list[str]) -> list[PluginDependency]:
        """
        Generate dependencies through the list of plugin ids
        """
        dependencies = list(set(dependencies))
        manager = PluginInstallationManager()
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
