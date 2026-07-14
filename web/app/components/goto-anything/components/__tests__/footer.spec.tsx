import { render, screen } from '@testing-library/react'
import { Footer } from '../footer'

const defaultProps = {
  resultCount: 0,
  searchMode: 'general',
  isLoading: false,
  hasUnavailableServices: false,
  isCommandsMode: false,
  hasQuery: false,
}

describe('Footer', () => {
  it('shows the result count and active scope', () => {
    render(<Footer {...defaultProps} resultCount={3} searchMode="@app" hasQuery />)

    expect(screen.getByText('app.gotoAnything.resultCount:{"count":3}')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.inScope:{"scope":"app"}')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.clearToSearchAll')).toBeInTheDocument()
  })

  it('reports partial provider failure even when results remain available', () => {
    render(<Footer {...defaultProps} resultCount={2} hasUnavailableServices hasQuery />)

    expect(screen.getByText('app.gotoAnything.someServicesUnavailable')).toHaveClass('text-red-500')
    expect(screen.getByText('app.gotoAnything.useAtForSpecific')).toBeInTheDocument()
  })

  it('reports pending remote search', () => {
    render(<Footer {...defaultProps} isLoading hasQuery />)

    expect(screen.getByText('app.gotoAnything.searching')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.tips')).toBeInTheDocument()
  })

  it('reports command selection mode', () => {
    render(<Footer {...defaultProps} isCommandsMode />)

    expect(screen.getByText('app.gotoAnything.selectToNavigate')).toBeInTheDocument()
  })

  it('shows the idle shortcut hint', () => {
    const { container } = render(<Footer {...defaultProps} />)

    expect(screen.getByText('app.gotoAnything.startTyping')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.pressEscToClose')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass(
      'border-t',
      'border-divider-subtle',
      'bg-components-panel-bg-blur',
    )
  })
})
