import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import EmptySearchResult from '../empty-search-result'

describe('EmptySearchResult', () => {
  const onResetKeywords = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state message', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    expect(screen.getByText('datasetPipeline.onlineDrive.emptySearchResult')).toBeInTheDocument()
  })

  it('should render reset button', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    expect(screen.getByText('datasetPipeline.onlineDrive.resetKeywords')).toBeInTheDocument()
  })

  it('should call onResetKeywords when reset button clicked', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    fireEvent.click(screen.getByText('datasetPipeline.onlineDrive.resetKeywords'))
    expect(onResetKeywords).toHaveBeenCalledOnce()
  })
})
