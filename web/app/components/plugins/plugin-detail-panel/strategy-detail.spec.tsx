import type { StrategyDetail as StrategyDetailType } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StrategyDetail from './strategy-detail'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string>) => obj?.en_US || '',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: () => <span data-testid="card-icon" />,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

type ProviderType = Parameters<typeof StrategyDetail>[0]['provider']

const mockProvider = {
  author: 'test-author',
  name: 'test-provider',
  description: { en_US: 'Provider desc' },
  tenant_id: 'tenant-1',
  icon: 'icon.png',
  label: { en_US: 'Test Provider' },
  tags: [],
} as unknown as ProviderType

const mockDetail = {
  identity: {
    author: 'author-1',
    name: 'strategy-1',
    icon: 'icon.png',
    label: { en_US: 'Strategy Label' },
    provider: 'provider-1',
  },
  parameters: [
    {
      name: 'param1',
      label: { en_US: 'Parameter 1' },
      type: 'text-input',
      required: true,
      human_description: { en_US: 'A text parameter' },
    },
  ],
  description: { en_US: 'Strategy description' },
  output_schema: {
    properties: {
      result: { type: 'string', description: 'Result output' },
      items: { type: 'array', items: { type: 'string' }, description: 'Array items' },
    },
  },
  features: [],
} as unknown as StrategyDetailType

describe('StrategyDetail', () => {
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render drawer', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render provider label', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByText('Test Provider')).toBeInTheDocument()
    })

    it('should render strategy label', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByText('Strategy Label')).toBeInTheDocument()
    })

    it('should render parameters section', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByText('setBuiltInTools.parameters')).toBeInTheDocument()
      expect(screen.getByText('Parameter 1')).toBeInTheDocument()
    })

    it('should render output schema section', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByText('OUTPUT')).toBeInTheDocument()
      expect(screen.getByText('result')).toBeInTheDocument()
      expect(screen.getByText('String')).toBeInTheDocument()
    })

    it('should render BACK button', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      expect(screen.getByText('BACK')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onHide when close button clicked', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      // Find the close button (ActionButton with action-btn class)
      const closeButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (closeButton)
        fireEvent.click(closeButton)

      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when BACK clicked', () => {
      render(<StrategyDetail provider={mockProvider} detail={mockDetail} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('BACK'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })
  })

  describe('Parameter Types', () => {
    it('should display correct type for number-input', () => {
      const detailWithNumber = {
        ...mockDetail,
        parameters: [{ ...mockDetail.parameters[0], type: 'number-input' }],
      }
      render(<StrategyDetail provider={mockProvider} detail={detailWithNumber} onHide={mockOnHide} />)

      expect(screen.getByText('setBuiltInTools.number')).toBeInTheDocument()
    })

    it('should display correct type for checkbox', () => {
      const detailWithCheckbox = {
        ...mockDetail,
        parameters: [{ ...mockDetail.parameters[0], type: 'checkbox' }],
      }
      render(<StrategyDetail provider={mockProvider} detail={detailWithCheckbox} onHide={mockOnHide} />)

      expect(screen.getByText('boolean')).toBeInTheDocument()
    })

    it('should display correct type for file', () => {
      const detailWithFile = {
        ...mockDetail,
        parameters: [{ ...mockDetail.parameters[0], type: 'file' }],
      }
      render(<StrategyDetail provider={mockProvider} detail={detailWithFile} onHide={mockOnHide} />)

      expect(screen.getByText('setBuiltInTools.file')).toBeInTheDocument()
    })

    it('should display correct type for array[tools]', () => {
      const detailWithArrayTools = {
        ...mockDetail,
        parameters: [{ ...mockDetail.parameters[0], type: 'array[tools]' }],
      }
      render(<StrategyDetail provider={mockProvider} detail={detailWithArrayTools} onHide={mockOnHide} />)

      expect(screen.getByText('multiple-tool-select')).toBeInTheDocument()
    })

    it('should display original type for unknown types', () => {
      const detailWithUnknown = {
        ...mockDetail,
        parameters: [{ ...mockDetail.parameters[0], type: 'custom-type' }],
      }
      render(<StrategyDetail provider={mockProvider} detail={detailWithUnknown} onHide={mockOnHide} />)

      expect(screen.getByText('custom-type')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty parameters', () => {
      const detailEmpty = { ...mockDetail, parameters: [] }
      render(<StrategyDetail provider={mockProvider} detail={detailEmpty} onHide={mockOnHide} />)

      expect(screen.getByText('setBuiltInTools.parameters')).toBeInTheDocument()
    })

    it('should handle no output schema', () => {
      const detailNoOutput = { ...mockDetail, output_schema: undefined as unknown as Record<string, unknown> }
      render(<StrategyDetail provider={mockProvider} detail={detailNoOutput} onHide={mockOnHide} />)

      expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument()
    })
  })
})
