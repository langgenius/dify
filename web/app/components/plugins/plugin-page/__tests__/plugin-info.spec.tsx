import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../base/modal', () => ({
  default: ({ children, title, isShow }: { children: React.ReactNode, title: string, isShow: boolean }) => (
    isShow
      ? (
          <div data-testid="modal">
            <div data-testid="modal-title">{title}</div>
            {children}
          </div>
        )
      : null
  ),
}))

vi.mock('../../base/key-value-item', () => ({
  default: ({ label, value }: { label: string, value: string }) => (
    <div data-testid="key-value-item">
      <span data-testid="kv-label">{label}</span>
      <span data-testid="kv-value">{value}</span>
    </div>
  ),
}))

vi.mock('../../install-plugin/utils', () => ({
  convertRepoToUrl: (repo: string) => `https://github.com/${repo}`,
}))

describe('PlugInfo', () => {
  let PlugInfo: (typeof import('../plugin-info'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../plugin-info')
    PlugInfo = mod.default
  })

  it('should render modal with title', () => {
    render(<PlugInfo onHide={vi.fn()} />)

    expect(screen.getByTestId('modal')).toBeInTheDocument()
    expect(screen.getByTestId('modal-title')).toHaveTextContent('plugin.pluginInfoModal.title')
  })

  it('should display repository info', () => {
    render(<PlugInfo repository="org/plugin" onHide={vi.fn()} />)

    const kvItems = screen.getAllByTestId('key-value-item')
    expect(kvItems.length).toBeGreaterThanOrEqual(1)
    const values = screen.getAllByTestId('kv-value')
    expect(values.some(v => v.textContent?.includes('https://github.com/org/plugin'))).toBe(true)
  })

  it('should display release info', () => {
    render(<PlugInfo release="v1.0.0" onHide={vi.fn()} />)

    const values = screen.getAllByTestId('kv-value')
    expect(values.some(v => v.textContent === 'v1.0.0')).toBe(true)
  })

  it('should display package name', () => {
    render(<PlugInfo packageName="my-plugin.difypkg" onHide={vi.fn()} />)

    const values = screen.getAllByTestId('kv-value')
    expect(values.some(v => v.textContent === 'my-plugin.difypkg')).toBe(true)
  })

  it('should not show items for undefined props', () => {
    render(<PlugInfo onHide={vi.fn()} />)

    expect(screen.queryAllByTestId('key-value-item')).toHaveLength(0)
  })
})
