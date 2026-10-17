import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataSourceType } from '@/models/datasets'
import DataSourceTypeSelector from '../data-source-type-selector'

vi.mock('@/config', () => ({
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: true,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

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

  it('changes source with the keyboard and exposes the selected option', async () => {
    const user = userEvent.setup()
    const Example = () => {
      const [value, setValue] = useState<DataSourceType>(DataSourceType.FILE)
      return <DataSourceTypeSelector {...defaultProps} currentType={value} onChange={setValue} />
    }
    render(<Example />)
    await user.tab()
    expect(
      screen.getByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.file' }),
    ).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.notion' }),
    ).toBeChecked()
    expect(defaultProps.onClearPreviews).toHaveBeenCalledWith(DataSourceType.NOTION)
  })

  it('does not change data source type while disabled', async () => {
    const user = userEvent.setup()
    render(<DataSourceTypeSelector {...defaultProps} disabled />)

    await user.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

    expect(defaultProps.onChange).not.toHaveBeenCalled()
    expect(defaultProps.onClearPreviews).not.toHaveBeenCalled()
  })
})
