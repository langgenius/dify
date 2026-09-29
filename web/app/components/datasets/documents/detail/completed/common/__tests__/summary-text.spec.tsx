import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SummaryText from '../summary-text'

describe('SummaryText', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render summary heading', () => {
    render(<SummaryText />)
    expect(screen.getByText('datasetDocuments.segment.summary')).toBeInTheDocument()
  })

  it('should render value in textarea', () => {
    render(<SummaryText value="My summary" onChange={onChange} />)
    expect(screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })).toHaveValue(
      'My summary',
    )
  })

  it('should render empty string when value is undefined', () => {
    render(<SummaryText onChange={onChange} />)
    expect(screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })).toHaveValue(
      '',
    )
  })

  it('should call onChange when text changes', () => {
    render(<SummaryText value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' }), {
      target: { value: 'new summary' },
    })
    expect(onChange).toHaveBeenCalledWith('new summary')
  })

  it('should disable textarea when disabled', () => {
    render(<SummaryText value="text" disabled />)
    expect(screen.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })).toBeDisabled()
  })
})
