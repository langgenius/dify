import type { Plugin, PluginDeclaration } from "../types"

export const pluginManifestToCardPluginProps = (pluginManifest: PluginDeclaration): Plugin => {
  return {
    type: pluginManifest.category,
    category: pluginManifest.category,
    name: pluginManifest.name,
    version: pluginManifest.version,
    latest_version: '',
    org: pluginManifest.author,
    label: pluginManifest.label,
    brief: pluginManifest.description,
    icon: pluginManifest.icon,
    introduction: '',
    repository: '',
    install_count: 0,
    endpoint: {
      settings: []
    }
  }
}
