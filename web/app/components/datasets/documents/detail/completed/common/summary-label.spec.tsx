import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SummaryLabel from './summary-label'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('SummaryLabel', () => {
  it('should render summary heading', () => {
    render(<SummaryLabel summary="This is a summary" />)
    expect(screen.getByText('segment.summary')).toBeInTheDocument()
  })

  it('should render summary text', () => {
    render(<SummaryLabel summary="This is a summary" />)
    expect(screen.getByText('This is a summary')).toBeInTheDocument()
  })

  it('should render without summary text', () => {
    render(<SummaryLabel />)
    expect(screen.getByText('segment.summary')).toBeInTheDocument()
  })
})
