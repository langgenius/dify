import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PluginsSelected from '../plugins-selected'

vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.example.com',
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="plugin-icon">{src}</div>,
}))

describe('PluginsSelected', () => {
  it('renders all selected plugin icons when the count is below the limit', () => {
    render(<PluginsSelected plugins={['dify/plugin-1', 'dify/plugin-2']} />)

    expect(screen.getAllByTestId('plugin-icon')).toHaveLength(2)
    expect(screen.getByText('https://marketplace.example.com/plugins/dify/plugin-1/icon')).toBeInTheDocument()
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })

  it('renders the overflow badge when more than fourteen plugins are selected', () => {
    const plugins = Array.from({ length: 16 }, (_, index) => `dify/plugin-${index}`)
    render(<PluginsSelected plugins={plugins} />)

    expect(screen.getAllByTestId('plugin-icon')).toHaveLength(14)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})
