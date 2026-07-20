import { render, screen } from '@testing-library/react'
import DatasetFirstEmptyState from '..'

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

describe('DatasetFirstEmptyState', () => {
  it('links to pipeline creation when creation is available', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    expect(
      screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).toHaveAttribute('href', '/datasets/create-from-pipeline')
  })

  it('only offers external connection without dataset creation permission', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset={false} />)

    expect(
      screen.queryByRole('link', { name: /dataset\.firstEmpty\.createTitle/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dataset\.connectDataset/ })).toHaveAttribute(
      'href',
      '/datasets/connect',
    )
  })

  it('renders nothing when no empty-state action is available', () => {
    const { container } = render(
      <DatasetFirstEmptyState canConnectExternalDataset={false} canCreateDataset={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
