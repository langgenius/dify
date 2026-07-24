import { fireEvent, render, screen } from '@testing-library/react'
import ConfigModel from './config-model'

// Mock icons
vi.mock('@remixicon/react', () => ({
  RiEqualizer2Line: () => <div data-testid="config-icon" />,
  RiScales3Line: () => <div data-testid="scales-icon" />,
}))

// Mock Indicator
vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid={`indicator-${color}`} />,
}))

describe('ConfigModel', () => {
  it('should render authorization error when loadBalancingInvalid is true', () => {
    const onClick = vi.fn()
    render(<ConfigModel loadBalancingInvalid onClick={onClick} />)

    expect(screen.getByText(/modelProvider.auth.authorizationError/)).toBeInTheDocument()
    expect(screen.getByTestId('scales-icon')).toBeInTheDocument()
    expect(screen.getByTestId('indicator-orange')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider.auth.authorizationError/))
    expect(onClick).toHaveBeenCalled()
  })

  it('should render credential removed message when credentialRemoved is true', () => {
    render(<ConfigModel credentialRemoved />)

    expect(screen.getByText(/modelProvider.auth.credentialRemoved/)).toBeInTheDocument()
    expect(screen.getByTestId('indicator-red')).toBeInTheDocument()
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
