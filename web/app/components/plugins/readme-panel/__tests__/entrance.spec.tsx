import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const mockSetCurrentPluginDetail = vi.fn()

vi.mock('../store', () => ({
  ReadmeShowType: { drawer: 'drawer', side: 'side', modal: 'modal' },
  useReadmePanelStore: () => ({
    setCurrentPluginDetail: mockSetCurrentPluginDetail,
  }),
}))

vi.mock('../constants', () => ({
  BUILTIN_TOOLS_ARRAY: ['google_search', 'bing_search'],
}))

describe('ReadmeEntrance', () => {
  let ReadmeEntrance: (typeof import('../entrance'))['ReadmeEntrance']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../entrance')
    ReadmeEntrance = mod.ReadmeEntrance
  })

  it('should render readme button for non-builtin plugin with unique identifier', () => {
    const pluginDetail = { id: 'custom-plugin', name: 'custom-plugin', plugin_unique_identifier: 'org/custom-plugin' } as never
    render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call setCurrentPluginDetail on button click', () => {
    const pluginDetail = { id: 'custom-plugin', name: 'custom-plugin', plugin_unique_identifier: 'org/custom-plugin' } as never
    render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(mockSetCurrentPluginDetail).toHaveBeenCalledWith(pluginDetail, 'drawer')
  })

  it('should return null for builtin tools', () => {
    const pluginDetail = { id: 'google_search', name: 'Google Search', plugin_unique_identifier: 'org/google' } as never
    const { container } = render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(container.innerHTML).toBe('')
  })

  it('should return null when plugin_unique_identifier is missing', () => {
    const pluginDetail = { id: 'some-plugin', name: 'Some Plugin' } as never
    const { container } = render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(container.innerHTML).toBe('')
  })

  it('should return null when pluginDetail is null', () => {
    const { container } = render(<ReadmeEntrance pluginDetail={null as never} />)

    expect(container.innerHTML).toBe('')
  })
})
