import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import PluginCategoryPage from '../plugin-category-page'

const {
  mockContainerRef,
  mockUseUploader,
  mockPluginInstallationPermission,
} = vi.hoisted(() => ({
  mockContainerRef: { current: null },
  mockUseUploader: vi.fn((_: unknown) => ({
    dragging: false,
    fileUploader: { current: null },
    fileChangeHandle: undefined,
    removeFile: undefined,
  })),
  mockPluginInstallationPermission: {
    restrict_to_marketplace_only: false,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useSuspenseQuery: () => ({ data: mockPluginInstallationPermission }),
}))

vi.mock('@/app/components/plugins/plugin-page/context-provider', () => ({
  PluginPageContextProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/components/plugins/plugin-page/context', () => ({
  usePluginPageContext: (selector: (value: {
    containerRef: typeof mockContainerRef
  }) => unknown) => selector({ containerRef: mockContainerRef }),
}))

vi.mock('@/app/components/plugins/plugin-page/plugins-panel', () => ({
  default: ({ canInstall, fixedCategory, onSwitchToMarketplace }: { canInstall?: boolean, fixedCategory: PluginCategoryEnum, onSwitchToMarketplace?: () => void }) => (
    <div data-can-install={canInstall ? 'true' : 'false'} data-fixed-category={fixedCategory} data-has-marketplace-action={onSwitchToMarketplace ? 'true' : 'false'} data-testid="plugins-panel" />
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-uploader', () => ({
  useUploader: (options: unknown) => mockUseUploader(options),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, installContextCategory }: { file: File, installContextCategory?: PluginCategoryEnum }) => (
    <div
      data-testid="install-from-local-package"
      data-file-name={file.name}
      data-install-context-category={installContextCategory}
    />
  ),
}))

type UploaderOptions = {
  onFileChange: (file: File | null) => void
}

describe('PluginCategoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginInstallationPermission.restrict_to_marketplace_only = false
  })

  it.each([
    [PluginCategoryEnum.tool, true],
    [PluginCategoryEnum.trigger, true],
    [PluginCategoryEnum.agent, true],
    [PluginCategoryEnum.extension, true],
  ])('sets drop install availability for %s', (category, enabled) => {
    render(<PluginCategoryPage category={category} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled,
    }))
  })

  it('uses the Figma panel background for scoped integration categories', () => {
    const { container } = render(<PluginCategoryPage category={PluginCategoryEnum.trigger} />)

    expect(container.firstElementChild).toHaveClass('bg-components-panel-bg')
  })

  it('passes the marketplace action to the plugins panel', () => {
    const onSwitchToMarketplace = vi.fn()

    render(<PluginCategoryPage category={PluginCategoryEnum.extension} onSwitchToMarketplace={onSwitchToMarketplace} />)

    expect(screen.getByTestId('plugins-panel')).toHaveAttribute('data-has-marketplace-action', 'true')
  })

  it('disables drop install when local packages are restricted', () => {
    mockPluginInstallationPermission.restrict_to_marketplace_only = true

    render(<PluginCategoryPage category={PluginCategoryEnum.agent} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('disables panel and drop installs when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.agent} />)

    expect(screen.getByTestId('plugins-panel')).toHaveAttribute('data-can-install', 'false')
    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('opens the local package installer for supported dropped files', () => {
    render(<PluginCategoryPage category={PluginCategoryEnum.tool} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'tool.difypkg'))
    })

    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-file-name', 'tool.difypkg')
    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-install-context-category', PluginCategoryEnum.tool)
  })

  it('ignores dropped files when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.agent} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'agent.difybndl'))
    })

    expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
  })
})
