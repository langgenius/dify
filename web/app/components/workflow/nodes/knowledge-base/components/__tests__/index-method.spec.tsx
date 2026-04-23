import { fireEvent, render, screen } from '@testing-library/react'
import { ChunkStructureEnum, IndexMethodEnum } from '../../types'
import IndexMethod from '../index-method'

describe('IndexMethod', () => {
  it('should render both index method options for general chunks and notify option changes', () => {
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

    fireEvent.click(screen.getByText('datasetSettings.form.indexMethodEconomy'))

    expect(onIndexMethodChange).toHaveBeenCalledWith(IndexMethodEnum.ECONOMICAL)
  })

  it('should update the keyword number when the economical option is active', () => {
    const onKeywordNumberChange = vi.fn()
    const { container } = render(
      <IndexMethod
        chunkStructure={ChunkStructureEnum.general}
        indexMethod={IndexMethodEnum.ECONOMICAL}
        keywordNumber={5}
        onIndexMethodChange={vi.fn()}
        onKeywordNumberChange={onKeywordNumberChange}
      />,
    )

    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: '7' } })

    expect(onKeywordNumberChange).toHaveBeenCalledWith(7, expect.anything())
  })

  it('should disable keyword controls when readonly is enabled', () => {
    const { container } = render(
      <IndexMethod
        chunkStructure={ChunkStructureEnum.general}
        indexMethod={IndexMethodEnum.ECONOMICAL}
        keywordNumber={5}
        onIndexMethodChange={vi.fn()}
        onKeywordNumberChange={vi.fn()}
        readonly
      />,
    )

    expect(container.querySelector('input')).toBeDisabled()
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
