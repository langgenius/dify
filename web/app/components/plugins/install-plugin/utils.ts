import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../types'
import type { GitHubUrlInfo } from '@/app/components/plugins/types'
import { isEmpty } from 'lodash-es'

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
    tags: pluginManifest.tags.map(tag => ({ name: tag })),
    badges: [],
    verification: { authorized_category: 'langgenius' },
    from: 'package',
  }
}

export const pluginManifestInMarketToPluginProps = (pluginManifest: PluginManifestInMarket): Plugin => {
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
    verification: isEmpty(pluginManifest.verification) ? { authorized_category: 'langgenius' } : pluginManifest.verification,
    from: pluginManifest.from,
  }
}

export const parseGitHubUrl = (url: string): GitHubUrlInfo => {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/)
  return match ? { isValid: true, owner: match[1], repo: match[2] } : { isValid: false }
}

export const convertRepoToUrl = (repo: string) => {
  return repo ? `https://github.com/${repo}` : ''
}
