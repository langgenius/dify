import { fireEvent, render, screen } from '@testing-library/react'
import ConfigModel from '../config-model'

// Mock icons
vi.mock('@remixicon/react', () => ({
  RiEqualizer2Line: () => <div data-testid="config-icon" />,
  RiScales3Line: () => <div data-testid="scales-icon" />,
}))

// Mock Indicator
vi.mock('@langgenius/dify-ui/status-dot', () => ({
  StatusDot: ({ status }: { status: string }) => <div data-testid={`indicator-${status}`} />,
}))

describe('ConfigModel', () => {
  it('should render authorization error when loadBalancingInvalid is true', () => {
    const onClick = vi.fn()
    render(<ConfigModel loadBalancingInvalid onClick={onClick} />)

    expect(screen.getByText(/modelProvider.auth.authorizationError/)).toBeInTheDocument()
    expect(screen.getByTestId('scales-icon')).toBeInTheDocument()
    expect(screen.getByTestId('indicator-warning')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider.auth.authorizationError/))
    expect(onClick).toHaveBeenCalled()
  })

  it('should render credential removed message when credentialRemoved is true', () => {
    render(<ConfigModel credentialRemoved />)

    expect(screen.getByText(/modelProvider.auth.credentialRemoved/)).toBeInTheDocument()
    expect(screen.getByTestId('indicator-error')).toBeInTheDocument()
  })

  it('should render standard config message when no flags enabled', () => {
    render(<ConfigModel />)

    expect(screen.getByText(/operation.config/)).toBeInTheDocument()
    expect(screen.getByTestId('config-icon')).toBeInTheDocument()
  })

  it('should render config load balancing when loadBalancingEnabled is true', () => {
    render(<ConfigModel loadBalancingEnabled />)

    expect(screen.getByText(/modelProvider.auth.configLoadBalancing/)).toBeInTheDocument()
    expect(screen.getByTestId('scales-icon')).toBeInTheDocument()
  })
})
