import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'

// Mock config to control web crawl feature flags
vi.mock('@/config', () => ({
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: true,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

// Mock CSS module
vi.mock('../../../index.module.css', () => ({
  default: {
    dataSourceItem: 'ds-item',
    active: 'active',
    disabled: 'disabled',
    datasetIcon: 'icon',
    notion: 'notion-icon',
    web: 'web-icon',
  },
}))

const { default: DataSourceTypeSelector } = await import('../data-source-type-selector')

describe('DataSourceTypeSelector', () => {
  const defaultProps = {
    currentType: DataSourceType.FILE,
    disabled: false,
    onChange: vi.fn(),
    onClearPreviews: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render file, notion, and web options', () => {
      render(<DataSourceTypeSelector {...defaultProps} />)
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.web')).toBeInTheDocument()
    })

    it('should render as a 3-column grid', () => {
      const { container } = render(<DataSourceTypeSelector {...defaultProps} />)
      expect(container.firstElementChild).toHaveClass('grid-cols-3')
    })
  })

  describe('interactions', () => {
    it('should call onChange and onClearPreviews on type click', () => {
      render(<DataSourceTypeSelector {...defaultProps} />)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))
      expect(defaultProps.onChange).toHaveBeenCalledWith(DataSourceType.NOTION)
      expect(defaultProps.onClearPreviews).toHaveBeenCalledWith(DataSourceType.NOTION)
    })

    it('should not call onChange when disabled', () => {
      render(<DataSourceTypeSelector {...defaultProps} disabled />)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))
      expect(defaultProps.onChange).not.toHaveBeenCalled()
    })
  })
})
