import { fireEvent, render, screen } from '@testing-library/react'
import ToolHeader from '../tool-header'

vi.mock('@/app/components/base/app-icon', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="app-icon">{JSON.stringify(props)}</div>
  ),
}))

describe('ToolHeader', () => {
  it('should render labels and close action without an icon', () => {
    const onClose = vi.fn()

    render(
      <ToolHeader
        icon={undefined}
        providerLabel="Provider"
        toolLabel="Tool"
        description="Description"
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.getByText('Tool')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.queryByTestId('app-icon')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should render a remote icon and invoke the back action', () => {
    const onBack = vi.fn()

    const { container } = render(
      <ToolHeader
        icon="https://cdn.example.com/icon.png"
        providerLabel="Provider"
        toolLabel="Tool"
        description="Description"
        onClose={vi.fn()}
        onBack={onBack}
        backLabel="Back to tools"
      />,
    )

    const remoteIcon = container.querySelector('[style*="background-image"]')

    expect(remoteIcon).toHaveStyle({ backgroundImage: 'url(https://cdn.example.com/icon.png)' })

    fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('should render app icons for both icon names and emoji payloads', () => {
    const { rerender } = render(
      <ToolHeader
        icon="ri-search-line"
        providerLabel="Provider"
        toolLabel="Tool"
        description="Description"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('app-icon')).toHaveTextContent('"icon":"ri-search-line"')

    rerender(
      <ToolHeader
        icon={{ content: 'moon', background: '#000000' }}
        providerLabel="Provider"
        toolLabel="Tool"
        description="Description"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('app-icon')).toHaveTextContent('"icon":"moon"')
    expect(screen.getByTestId('app-icon')).toHaveTextContent('"background":"#000000"')
  })
})
