import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataSourceType } from '@/models/datasets'

vi.mock('@/config', () => ({
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: true,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

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

const defaultProps = {
  currentType: DataSourceType.FILE,
  disabled: false,
  onChange: vi.fn(),
  onClearPreviews: vi.fn(),
}

describe('DataSourceTypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the available data source types', () => {
    render(<DataSourceTypeSelector {...defaultProps} />)

    expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepOne.dataSourceType.web')).toBeInTheDocument()
  })

  it('changes data source type and clears the previous preview', async () => {
    const user = userEvent.setup()
    render(<DataSourceTypeSelector {...defaultProps} />)

    await user.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

    expect(defaultProps.onChange).toHaveBeenCalledWith(DataSourceType.NOTION)
    expect(defaultProps.onClearPreviews).toHaveBeenCalledWith(DataSourceType.NOTION)
  })

  it('does not change data source type while disabled', async () => {
    const user = userEvent.setup()
    render(<DataSourceTypeSelector {...defaultProps} disabled />)

    await user.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })
})
