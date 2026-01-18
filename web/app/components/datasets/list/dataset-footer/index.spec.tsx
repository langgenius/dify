import { render, screen } from '@testing-library/react'
import DatasetFooter from './index'

describe('DatasetFooter', () => {
  it('should render correctly', () => {
    render(<DatasetFooter />)

    // Check main title (mocked i18n returns ns:key or key)
    // The code uses t('didYouKnow', { ns: 'dataset' })
    // With default mock it likely returns 'dataset.didYouKnow'
    expect(screen.getByText('dataset.didYouKnow')).toBeInTheDocument()

    // Check paragraph content
    expect(screen.getByText(/dataset.intro1/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.intro2/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.intro3/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.intro4/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.intro5/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.intro6/)).toBeInTheDocument()
  })

  it('should have correct styling', () => {
    const { container } = render(<DatasetFooter />)
    const footer = container.querySelector('footer')
    expect(footer).toHaveClass('shrink-0', 'px-12', 'py-6')

    const h3 = container.querySelector('h3')
    expect(h3).toHaveClass('text-gradient')
  })
})
