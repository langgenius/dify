from enum import StrEnum

from pydantic import BaseModel

from core.plugin.entities.plugin import PluginDeclaration, PluginInstallationSource


class PluginBundleDependency(BaseModel):
    class Type(StrEnum):
        Github = PluginInstallationSource.Github.value
        Marketplace = PluginInstallationSource.Marketplace.value
        Package = PluginInstallationSource.Package.value

    class Github(BaseModel):
        repo_address: str
        repo: str
        release: str
        packages: str

    class Marketplace(BaseModel):
        organization: str
        plugin: str
        version: str

    class Package(BaseModel):
        unique_identifier: str
        manifest: PluginDeclaration

    type: Type
    value: Github | Marketplace | Package
