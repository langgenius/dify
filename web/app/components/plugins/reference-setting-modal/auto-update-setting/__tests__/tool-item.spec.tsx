import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolItem from '../tool-item'

vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.example.com',
}))
vi.mock('@/i18n-config', () => ({
  renderI18nObject: (value: Record<string, string>, language: string) => value[language],
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="plugin-icon">{src}</div>,
}))

const payload = {
  plugin_id: 'dify/plugin-1',
  declaration: {
    label: {
      en_US: 'Plugin One',
      zh_Hans: 'Plugin One',
    },
    author: 'Dify',
  },
} as PluginDetail

describe('ToolItem', () => {
  it('renders plugin metadata and marketplace icon', () => {
    render(<ToolItem payload={payload} isChecked onCheckChange={vi.fn()} />)

    expect(screen.getByText('Plugin One')).toBeInTheDocument()
    expect(screen.getByText('Dify')).toBeInTheDocument()
    expect(screen.getByText('https://marketplace.example.com/plugins/dify/plugin-1/icon')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Plugin One' })).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onCheckChange when checkbox is clicked', () => {
    const onCheckChange = vi.fn()
    render(<ToolItem payload={payload} onCheckChange={onCheckChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Plugin One' }))

    expect(onCheckChange).toHaveBeenCalledTimes(1)
  })
})
