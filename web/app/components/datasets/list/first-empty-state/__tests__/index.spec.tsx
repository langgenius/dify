import { render, screen } from '@testing-library/react'
import DatasetFirstEmptyState from '..'

vi.mock('@/next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

describe('DatasetFirstEmptyState', () => {
  it('uses the pipeline icon for the create-from-pipeline action', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    const pipelineLink = screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ })

    expect(pipelineLink).toHaveAttribute('href', '/datasets/create-from-pipeline')
    expect(pipelineLink.querySelector('.i-custom-vender-pipeline-pipeline-line')).toBeInTheDocument()
  })

  it('should hide dataset creation actions when dataset.create_and_management is unavailable', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset={false} />)

    expect(screen.queryByRole('link', { name: /dataset\.firstEmpty\.createTitle/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dataset\.connectDataset/ })).toHaveAttribute('href', '/datasets/connect')
  })

  it('should render nothing when no empty-state action is available', () => {
    const { container } = render(<DatasetFirstEmptyState canConnectExternalDataset={false} canCreateDataset={false} />)

    expect(container).toBeEmptyDOMElement()
  })
})
