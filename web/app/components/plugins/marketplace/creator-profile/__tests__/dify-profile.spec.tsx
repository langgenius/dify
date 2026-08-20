import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { MarketplaceSearchSelection } from '../../home/marketplace-search-autocomplete'
import type { LoadedCreatorProfile } from '../model'
import type { Plugin } from '@/app/components/plugins/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithNuqs } from '@/test/nuqs-testing'
import DifyCreatorProfile from '../dify-profile'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  installedInfo: { 'dify/deep_research': { version: '0.0.1' } },
}))

const deepResearchPlugin = {
  type: 'plugin',
  org: 'dify',
  name: 'deep_research',
  plugin_id: 'dify/deep_research',
  latest_package_identifier: 'dify/deep_research:0.0.1@test',
  label: { 'en-US': 'Deep Research' },
  brief: { 'en-US': 'Research the web.' },
} as unknown as Plugin

const searchPlugin = {
  ...deepResearchPlugin,
  name: 'search_result',
  plugin_id: 'dify/search_result',
  latest_package_identifier: 'dify/search_result:0.0.1@test',
  label: { 'en-US': 'Search result' },
} as Plugin

const template: MarketplaceTemplate = {
  id: 'template-one',
  template_name: 'Research Template',
  overview: 'Build a research app.',
  icon: 'R',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 1,
  categories: [],
}

const loadedProfile: LoadedCreatorProfile = {
  viewModel: {
    profile: {
      kind: 'individual',
      displayName: 'Creator',
      handle: 'creator',
      avatarUrl: '',
      backgroundUrl: '',
      badges: [],
      socialLinks: [],
    },
    creations: [
      {
        id: 'plugin:dify/deep_research',
        kind: 'plugin',
        title: 'Deep Research',
        description: 'Research the web.',
        target: {
          type: 'plugin',
          pluginType: 'plugin',
          org: 'dify',
          name: 'deep_research',
        },
        icon: { type: 'emoji', value: 'R' },
        dependencyIcons: [],
        dependencyCount: 0,
        updatedAt: 1,
        createdAt: 1,
        popularity: 1,
      },
      {
        id: 'template:template-one',
        kind: 'template',
        title: 'Research Template',
        description: 'Build a research app.',
        target: {
          type: 'template',
          id: 'template-one',
          publisher: 'dify',
          templateName: 'Research Template',
        },
        icon: { type: 'emoji', value: 'R' },
        dependencyIcons: [],
        dependencyCount: 0,
        updatedAt: 1,
        createdAt: 1,
        popularity: 1,
      },
    ],
  },
  pluginsByCreationId: {
    'plugin:dify/deep_research': deepResearchPlugin,
  },
  templatesByCreationId: {
    'template:template-one': template,
  },
}

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: () => <div data-testid="account-section" />,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <span aria-hidden />,
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: mocks.installedInfo }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ manifest }: { manifest: { name: string } }) => (
    <div data-testid="install-plugin">{manifest.name}</div>
  ),
}))

vi.mock('../../detail-dialog', () => ({
  default: ({
    isInstalled,
    onInstall,
    plugin,
  }: {
    isInstalled: boolean
    onInstall: () => void
    plugin: { name: string }
  }) => (
    <div role="dialog" aria-label="plugin-detail">
      <span>{plugin.name}</span>
      <span>{isInstalled ? 'installed' : 'not installed'}</span>
      <button type="button" onClick={onInstall}>
        Install plugin
      </button>
    </div>
  ),
}))

vi.mock('../../templates/template-detail-dialog', () => ({
  default: ({
    onInstall,
    template,
  }: {
    onInstall: () => void
    template: { template_name: string }
  }) => (
    <div role="dialog" aria-label="template-detail">
      <span>{template.template_name}</span>
      <button type="button" onClick={onInstall}>
        Install template
      </button>
    </div>
  ),
}))

vi.mock('../header', () => ({
  default: ({
    onSuggestionSelect,
  }: {
    onSuggestionSelect: (selection: MarketplaceSearchSelection) => void
  }) => (
    <button
      type="button"
      onClick={() => {
        onSuggestionSelect({ kind: 'plugin', plugin: searchPlugin })
      }}
    >
      Select search plugin
    </button>
  ),
}))

describe('DifyCreatorProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the existing plugin detail flow with installed state', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.click(screen.getByRole('button', { name: 'Deep Research' }))

    const dialog = screen.getByRole('dialog', { name: 'plugin-detail' })
    expect(dialog).toHaveTextContent('deep_research')
    expect(dialog).toHaveTextContent('installed')

    await user.click(screen.getByRole('button', { name: 'Install plugin' }))
    expect(screen.getByTestId('install-plugin')).toHaveTextContent('deep_research')
  })

  it('opens a template detail and imports it inside Dify', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.click(screen.getByRole('button', { name: 'Research Template' }))
    expect(screen.getByRole('dialog', { name: 'template-detail' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Install template' }))
    expect(mocks.push).toHaveBeenCalledWith('/apps?template-id=template-one')
  })

  it('opens search results in the same plugin dialog controller', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.click(screen.getByRole('button', { name: 'Select search plugin' }))

    const dialog = screen.getByRole('dialog', { name: 'plugin-detail' })
    expect(dialog).toHaveTextContent('search_result')
    expect(dialog).toHaveTextContent('not installed')
  })
})
