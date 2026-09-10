import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChunkStructureEnum, IndexMethodEnum } from '../../types'
import IndexMethod from '../index-method'

function KeywordSettings({ onChange }: { onChange: (value: number) => void }) {
  const [value, setValue] = useState(5)
  return (
    <IndexMethod
      chunkStructure={ChunkStructureEnum.general}
      indexMethod={IndexMethodEnum.ECONOMICAL}
      keywordNumber={value}
      onIndexMethodChange={vi.fn()}
      onKeywordNumberChange={(value) => {
        setValue(value)
        onChange(value)
      }}
    />
  )
}

describe('IndexMethod', () => {
  it('should render both index method options for general chunks and notify option changes', async () => {
    const user = userEvent.setup()
    const onIndexMethodChange = vi.fn()

    render(
      <IndexMethod
        chunkStructure={ChunkStructureEnum.general}
        indexMethod={IndexMethodEnum.QUALIFIED}
        keywordNumber={5}
        onIndexMethodChange={onIndexMethodChange}
        onKeywordNumberChange={vi.fn()}
      />,
    )

    expect(screen.getByText('datasetCreation.stepTwo.qualified')).toBeInTheDocument()
    expect(screen.getByText('datasetSettings.form.indexMethodEconomy')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepTwo.recommend')).toBeInTheDocument()

    await user.click(screen.getByText('datasetSettings.form.indexMethodEconomy'))

    expect(onIndexMethodChange).toHaveBeenCalledWith(IndexMethodEnum.ECONOMICAL)
  })

  it('shares integer keyword edits with the slider and retains the value when cleared', async () => {
    const user = userEvent.setup()
    const onKeywordNumberChange = vi.fn()
    render(<KeywordSettings onChange={onKeywordNumberChange} />)
    const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
    await user.clear(input)
    await user.tab()
    expect(onKeywordNumberChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('5')
    await user.clear(input)
    await user.type(input, '7.8')
    await user.tab()
    expect(input).toHaveValue('8')
    expect(onKeywordNumberChange).toHaveBeenLastCalledWith(8)
    expect(
      screen.getByRole('slider', { name: 'datasetSettings.form.numberOfKeywords' }),
    ).toHaveAttribute('aria-valuenow', '8')
    await user.click(screen.getByRole('button', { name: 'Increment value' }))
    expect(input).toHaveValue('9')
  })

  it('should disable keyword controls when readonly is enabled', () => {
    render(
      <IndexMethod
        chunkStructure={ChunkStructureEnum.general}
        indexMethod={IndexMethodEnum.ECONOMICAL}
        keywordNumber={5}
        onIndexMethodChange={vi.fn()}
        onKeywordNumberChange={vi.fn()}
        readonly
      />,
    )

    expect(
      screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increment value' })).toBeDisabled()
  })

  it('should hide the economical option for non-general chunk structures', () => {
    render(
      <IndexMethod
        chunkStructure={ChunkStructureEnum.parent_child}
        indexMethod={IndexMethodEnum.QUALIFIED}
        keywordNumber={5}
        onIndexMethodChange={vi.fn()}
        onKeywordNumberChange={vi.fn()}
      />,
    )

    expect(screen.getByText('datasetCreation.stepTwo.qualified')).toBeInTheDocument()
    expect(screen.queryByText('datasetSettings.form.indexMethodEconomy')).not.toBeInTheDocument()
  })
})
