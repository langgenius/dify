import type { ComponentProps } from 'react'
import type { StrategyDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StrategyItem from '../strategy-item'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: Record<string, string>) => value.en_US || '',
}))

vi.mock('../strategy-detail', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="strategy-detail-panel">
      <button onClick={onHide}>Close details</button>
    </div>
  ),
}))

const provider = {
  author: 'test-author',
  name: 'test-provider',
  description: { en_US: 'Provider description' },
  tenant_id: 'tenant-1',
  icon: 'icon.png',
  label: { en_US: 'Test Provider' },
  tags: [],
} as unknown as ComponentProps<typeof StrategyItem>['provider']

const detail = {
  identity: {
    author: 'author-1',
    name: 'strategy-1',
    icon: 'icon.png',
    label: { en_US: 'Strategy Label' },
    provider: 'provider-1',
  },
  parameters: [],
  description: { en_US: 'Strategy description' },
  output_schema: {},
  features: [],
} as unknown as StrategyDetail

describe('StrategyItem', () => {
  it('shows the localized strategy summary', () => {
    render(<StrategyItem provider={provider} detail={detail} />)

    expect(screen.getByText('Strategy Label')).toBeInTheDocument()
    expect(screen.getByText('Strategy description')).toBeInTheDocument()
  })

  it('opens and closes the strategy details', () => {
    render(<StrategyItem provider={provider} detail={detail} />)

    fireEvent.click(screen.getByText('Strategy Label'))
    expect(screen.getByTestId('strategy-detail-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByTestId('strategy-detail-panel')).not.toBeInTheDocument()
  })
})
