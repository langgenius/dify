import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmptySearchResult from './empty-search-result'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/components/base/icons/src/vender/knowledge', () => ({
  SearchMenu: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="search-icon" {...props} />,
}))

describe('EmptySearchResult', () => {
  const onResetKeywords = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state message', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    expect(screen.getByText('onlineDrive.emptySearchResult')).toBeInTheDocument()
  })

  it('should render reset button', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    expect(screen.getByText('onlineDrive.resetKeywords')).toBeInTheDocument()
  })

  it('should call onResetKeywords when reset button clicked', () => {
    render(<EmptySearchResult onResetKeywords={onResetKeywords} />)
    fireEvent.click(screen.getByText('onlineDrive.resetKeywords'))
    expect(onResetKeywords).toHaveBeenCalledOnce()
  })
})
