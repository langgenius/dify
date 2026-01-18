import type { StrategyDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StrategyItem from './strategy-item'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string>) => obj?.en_US || '',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('./strategy-detail', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="strategy-detail-panel">
      <button data-testid="hide-btn" onClick={onHide}>Hide</button>
    </div>
  ),
}))

const mockProvider = {
  author: 'test-author',
  name: 'test-provider',
  description: { en_US: 'Provider desc' } as Record<string, string>,
  tenant_id: 'tenant-1',
  icon: 'icon.png',
  label: { en_US: 'Test Provider' } as Record<string, string>,
  tags: [] as string[],
}

const mockDetail = {
  identity: {
    author: 'author-1',
    name: 'strategy-1',
    icon: 'icon.png',
    label: { en_US: 'Strategy Label' } as Record<string, string>,
    provider: 'provider-1',
  },
  parameters: [],
  description: { en_US: 'Strategy description' } as Record<string, string>,
  output_schema: {},
  features: [],
} as StrategyDetail

describe('StrategyItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render strategy label', () => {
      render(<StrategyItem provider={mockProvider} detail={mockDetail} />)

      expect(screen.getByText('Strategy Label')).toBeInTheDocument()
    })

    it('should render strategy description', () => {
      render(<StrategyItem provider={mockProvider} detail={mockDetail} />)

      expect(screen.getByText('Strategy description')).toBeInTheDocument()
    })

    it('should not show detail panel initially', () => {
      render(<StrategyItem provider={mockProvider} detail={mockDetail} />)

      expect(screen.queryByTestId('strategy-detail-panel')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should show detail panel when clicked', () => {
      render(<StrategyItem provider={mockProvider} detail={mockDetail} />)

      fireEvent.click(screen.getByText('Strategy Label'))

      expect(screen.getByTestId('strategy-detail-panel')).toBeInTheDocument()
    })

    it('should hide detail panel when hide is called', () => {
      render(<StrategyItem provider={mockProvider} detail={mockDetail} />)

      fireEvent.click(screen.getByText('Strategy Label'))
      expect(screen.getByTestId('strategy-detail-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('hide-btn'))
      expect(screen.queryByTestId('strategy-detail-panel')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should handle empty description', () => {
      const detailWithEmptyDesc = {
        ...mockDetail,
        description: { en_US: '' } as Record<string, string>,
      } as StrategyDetail
      render(<StrategyItem provider={mockProvider} detail={detailWithEmptyDesc} />)

      expect(screen.getByText('Strategy Label')).toBeInTheDocument()
    })
  })
})
