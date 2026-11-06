import type {
  I18nObject,
  PluginDeclarationResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { GitHubUrlInfo, Plugin, PluginDeclaration, PluginManifestInMarket } from '../types'
import { isEmpty } from 'es-toolkit/compat'

export const pluginManifestToCardPluginProps = (pluginManifest: PluginDeclaration): Plugin => {
  return {
    plugin_id: pluginManifest.plugin_unique_identifier,
    type: pluginManifest.category as Plugin['type'],
    category: pluginManifest.category,
    name: pluginManifest.name,
    version: pluginManifest.version,
    latest_version: '',
    latest_package_identifier: '',
    org: pluginManifest.author,
    author: pluginManifest.author,
    label: pluginManifest.label,
    brief: pluginManifest.description,
    description: pluginManifest.description,
    icon: pluginManifest.icon,
    icon_dark: pluginManifest.icon_dark,
    verified: pluginManifest.verified,
    introduction: '',
    repository: '',
    install_count: 0,
    endpoint: {
      settings: [],
    },
    tags: pluginManifest.tags.map((tag) => ({ name: tag })),
    badges: [],
    verification: { authorized_category: 'langgenius' },
    from: 'package',
  }
}

/** Plugin card text from a translated object; untranslated locales are left out. */
export const toPluginText = ({ en_US, zh_Hans, ja_JP, pt_BR }: I18nObject): Plugin['label'] => ({
  en_US,
  ...(zh_Hans != null && { zh_Hans }),
  ...(ja_JP != null && { ja_JP }),
  ...(pt_BR != null && { pt_BR }),
})

/** Card props for the manifest of a package the console has just uploaded. */
export const pluginDeclarationToCardPluginProps = (
  manifest: PluginDeclarationResponse,
  uniqueIdentifier: string,
): Plugin => ({
  plugin_id: uniqueIdentifier,
  type: manifest.category === 'agent-strategy' ? 'agent_strategy' : manifest.category,
  category: manifest.category,
  name: manifest.name,
  version: manifest.version,
  latest_version: '',
  latest_package_identifier: '',
  // A manifest without an author shows no organization.
  org: manifest.author ?? '',
  author: manifest.author ?? undefined,
  label: toPluginText(manifest.label),
  brief: toPluginText(manifest.description),
  description: toPluginText(manifest.description),
  icon: manifest.icon,
  icon_dark: manifest.icon_dark ?? undefined,
  verified: manifest.verified ?? false,
  introduction: '',
  repository: '',
  install_count: 0,
  endpoint: {
    settings: [],
  },
  tags: (manifest.tags ?? []).map((tag) => ({ name: tag })),
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'package',
})

export const pluginManifestInMarketToPluginProps = (
  pluginManifest: PluginManifestInMarket,
): Plugin => {
  return {
    plugin_id: pluginManifest.plugin_unique_identifier,
    type: pluginManifest.category as Plugin['type'],
    category: pluginManifest.category,
    name: pluginManifest.name,
    version: pluginManifest.latest_version,
    latest_version: pluginManifest.latest_version,
    latest_package_identifier: '',
    org: pluginManifest.org,
    label: pluginManifest.label,
    brief: pluginManifest.brief,
    description: pluginManifest.brief,
    icon: pluginManifest.icon,
    verified: true,
    introduction: pluginManifest.introduction,
    repository: '',
    install_count: 0,
    endpoint: {
      settings: [],
    },
    tags: [],
    badges: pluginManifest.badges,
    verification: isEmpty(pluginManifest.verification)
      ? { authorized_category: 'langgenius' }
      : pluginManifest.verification,
    from: pluginManifest.from,
  }
}

export const parseGitHubUrl = (url: string): GitHubUrlInfo => {
  const githubUrlRegex = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/
  const match = githubUrlRegex.exec(url)
  return match ? { isValid: true, owner: match[1], repo: match[2] } : { isValid: false }
}

export const convertRepoToUrl = (repo: string) => {
  return repo ? `https://github.com/${repo}` : ''
}
