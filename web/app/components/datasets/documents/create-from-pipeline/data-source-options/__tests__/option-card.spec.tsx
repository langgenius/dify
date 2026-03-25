import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OptionCard from '../option-card'

const TEST_ICON_URL = 'https://example.com/test-icon.png'

vi.mock('../hooks', () => ({
  useDatasourceIcon: () => TEST_ICON_URL,
}))

vi.mock('../datasource-icon', () => ({
  default: ({ iconUrl }: { iconUrl: string }) => (
    <img data-testid="datasource-icon" src={iconUrl} alt="datasource" />
  ),
}))

const createMockNodeData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Test Node',
  desc: '',
  type: {} as DataSourceNodeType['type'],
  plugin_id: 'test-plugin',
  provider_type: 'builtin',
  provider_name: 'test-provider',
  datasource_name: 'test-ds',
  datasource_label: 'Test DS',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

describe('OptionCard', () => {
  const defaultProps = {
    label: 'Google Drive',
    selected: false,
    nodeData: createMockNodeData(),
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: label text and icon
  describe('Rendering', () => {
    it('should render label text', () => {
      render(<OptionCard {...defaultProps} />)

      expect(screen.getByText('Google Drive')).toBeInTheDocument()
    })

    it('should render datasource icon with correct URL', () => {
      render(<OptionCard {...defaultProps} />)

      const icon = screen.getByTestId('datasource-icon')
      expect(icon).toHaveAttribute('src', TEST_ICON_URL)
    })

    it('should set title attribute on label element', () => {
      render(<OptionCard {...defaultProps} />)

      expect(screen.getByTitle('Google Drive')).toBeInTheDocument()
    })
  })

  // User interactions: clicking the card
  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      render(<OptionCard {...defaultProps} />)

      fireEvent.click(screen.getByText('Google Drive'))

      expect(defaultProps.onClick).toHaveBeenCalledOnce()
    })

    it('should not throw when onClick is undefined', () => {
      expect(() => {
        const { container } = render(
          <OptionCard {...defaultProps} onClick={undefined} />,
        )
        fireEvent.click(container.firstElementChild!)
      }).not.toThrow()
    })
  })

  // Props: selected state applies different styles
  describe('Props', () => {
    it('should apply selected styles when selected is true', () => {
      const { container } = render(<OptionCard {...defaultProps} selected />)

      const card = container.firstElementChild
      expect(card?.className).toContain('border-components-option-card-option-selected-border')
      expect(card?.className).toContain('bg-components-option-card-option-selected-bg')
    })

    it('should apply default styles when selected is false', () => {
      const { container } = render(<OptionCard {...defaultProps} selected={false} />)

      const card = container.firstElementChild
      expect(card?.className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should apply text-text-primary class to label when selected', () => {
      render(<OptionCard {...defaultProps} selected />)

      const labelEl = screen.getByTitle('Google Drive')
      expect(labelEl.className).toContain('text-text-primary')
    })
  })
})
