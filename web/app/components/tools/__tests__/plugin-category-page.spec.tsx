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
  default: ({ fixedCategory }: { fixedCategory: PluginCategoryEnum }) => (
    <div data-testid="plugins-panel" data-fixed-category={fixedCategory} />
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-uploader', () => ({
  useUploader: (options: unknown) => mockUseUploader(options),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file }: { file: File }) => <div data-testid="install-from-local-package" data-file-name={file.name} />,
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
    [PluginCategoryEnum.trigger, true],
    [PluginCategoryEnum.agent, true],
    [PluginCategoryEnum.extension, false],
  ])('sets drop install availability for %s', (category, enabled) => {
    render(<PluginCategoryPage category={category} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled,
    }))
  })

  it('disables drop install when local packages are restricted', () => {
    mockPluginInstallationPermission.restrict_to_marketplace_only = true

    render(<PluginCategoryPage category={PluginCategoryEnum.agent} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('opens the local package installer for supported dropped files', () => {
    render(<PluginCategoryPage category={PluginCategoryEnum.agent} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'agent.difybndl'))
    })

    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-file-name', 'agent.difybndl')
  })
})
