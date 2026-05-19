import type { ReactElement } from 'react'
import type { PluginDetail } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '../../types'
import { ReadmeEntrance } from '../entrance'
import ReadmePanel from '../index'
import { useReadmePanelStore } from '../store'

(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

const mockUsePluginReadme = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  usePluginReadme: (params: { plugin_unique_identifier: string, language?: string }) => mockUsePluginReadme(params),
}))

let mockLanguage = 'en-US'
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => mockLanguage,
}))

vi.mock('../../plugin-detail-panel/detail-header', () => ({
  default: ({ detail, isReadmeView }: { detail: PluginDetail, isReadmeView: boolean }) => (
    <div data-testid="detail-header" data-is-readme-view={isReadmeView}>
      {detail.name}
    </div>
  ),
}))

const createMockPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-plugin-id',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  name: 'test-plugin',
  plugin_id: 'test-plugin-id',
  plugin_unique_identifier: 'test-plugin@1.0.0',
  declaration: {
    plugin_unique_identifier: 'test-plugin@1.0.0',
    version: '1.0.0',
    author: 'test-author',
    icon: 'test-icon.png',
    name: 'test-plugin',
    category: PluginCategoryEnum.tool,
    label: { 'en-US': 'Test Plugin' } as Record<string, string>,
    description: { 'en-US': 'Test plugin description' } as Record<string, string>,
    created_at: '2024-01-01T00:00:00Z',
    resource: null,
    plugins: null,
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: {
      events: [],
      identity: {
        author: 'test-author',
        name: 'test-plugin',
        label: { 'en-US': 'Test Plugin' } as Record<string, string>,
        description: { 'en-US': 'Test plugin description' } as Record<string, string>,
        icon: 'test-icon.png',
        tags: [],
      },
      subscription_constructor: {
        credentials_schema: [],
        oauth_schema: { client_schema: [], credentials_schema: [] },
        parameters: [],
      },
      subscription_schema: [],
    },
  },
  installation_id: 'install-123',
  tenant_id: 'tenant-123',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-plugin@1.0.0',
  source: PluginSource.marketplace,
  status: 'active' as const,
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

const openReadmePanel = (
  detail = createMockPluginDetail(),
  presentation: 'drawer' | 'dialog' = 'drawer',
) => {
  useReadmePanelStore.getState().openReadmePanel({
    detail,
    presentation,
    triggerId: 'readme-trigger',
  })
  return detail
}

describe('ReadmePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en-US'
    useReadmePanelStore.setState({ currentPanel: undefined })
    mockUsePluginReadme.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
  })

  it('should return null when no readme panel is open', () => {
    const { container } = renderWithQueryClient(<ReadmePanel />)

    expect(container.firstChild).toBeNull()
  })

  it('should render drawer presentation with plugin header content', () => {
    openReadmePanel()

    renderWithQueryClient(<ReadmePanel />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('plugin.readmeInfo.title')).toBeInTheDocument()
    expect(screen.getByTestId('detail-header')).toHaveAttribute('data-is-readme-view', 'true')
    expect(screen.getByRole('dialog')).toHaveClass('data-[swipe-direction=left]:w-150')
  })

  it('should render dialog presentation when requested', () => {
    openReadmePanel(createMockPluginDetail(), 'dialog')

    renderWithQueryClient(<ReadmePanel />)

    expect(screen.getByRole('dialog')).toHaveClass('max-w-200')
  })

  it('should close the active panel when close button is clicked', () => {
    openReadmePanel()

    renderWithQueryClient(<ReadmePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(useReadmePanelStore.getState().currentPanel).toBeUndefined()
  })

  it('should render loading, error, empty, and readme states from the readme query', () => {
    openReadmePanel()
    mockUsePluginReadme.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })
    const { rerender } = renderWithQueryClient(<ReadmePanel />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    mockUsePluginReadme.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Failed to fetch'),
    })
    rerender(<ReadmePanel />)
    expect(screen.getByText('plugin.readmeInfo.failedToFetch')).toBeInTheDocument()

    mockUsePluginReadme.mockReturnValue({
      data: { readme: '' },
      isLoading: false,
      error: null,
    })
    rerender(<ReadmePanel />)
    expect(screen.getByText('plugin.readmeInfo.noReadmeAvailable')).toBeInTheDocument()

    mockUsePluginReadme.mockReturnValue({
      data: { readme: '# Test Readme Content' },
      isLoading: false,
      error: null,
    })
    rerender(<ReadmePanel />)
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })

  it('should call usePluginReadme with the plugin identifier and selected language', () => {
    openReadmePanel(createMockPluginDetail({
      plugin_unique_identifier: 'custom-plugin@2.0.0',
    }))

    renderWithQueryClient(<ReadmePanel />)

    expect(mockUsePluginReadme).toHaveBeenCalledWith({
      plugin_unique_identifier: 'custom-plugin@2.0.0',
      language: 'en-US',
    })
  })

  it('should pass undefined language for zh-Hans locale', () => {
    mockLanguage = 'zh-Hans'
    openReadmePanel(createMockPluginDetail({
      plugin_unique_identifier: 'zh-plugin@1.0.0',
    }))

    renderWithQueryClient(<ReadmePanel />)

    expect(mockUsePluginReadme).toHaveBeenCalledWith({
      plugin_unique_identifier: 'zh-plugin@1.0.0',
      language: undefined,
    })
  })

  it('should open correctly from ReadmeEntrance through the global host', () => {
    const detail = createMockPluginDetail()

    renderWithQueryClient(
      <>
        <ReadmeEntrance pluginDetail={detail} />
        <ReadmePanel />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: /plugin\.readmeInfo\.needHelpCheckReadme/ }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
