import { render, screen } from '@testing-library/react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import DatasetFirstEmptyState from '..'

vi.mock('@/next/link', () => ({
  default: ({ children, href, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} className={className} {...props}>{children}</a>
  ),
}))

describe('DatasetFirstEmptyState', () => {
  it('uses the pipeline icon for the create-from-pipeline action', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    const pipelineLink = screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ })

    expect(pipelineLink).toHaveAttribute('href', '/datasets/create-from-pipeline')
    expect(pipelineLink.querySelector('.i-custom-vender-pipeline-pipeline-line')).toBeInTheDocument()
  })

  it('exposes step-by-step tour targets for the empty knowledge actions', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    expect(screen.getByRole('link', { name: /dataset\.firstEmpty\.createTitle/ }))
      .toHaveAttribute('data-step-by-step-tour-target', STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyCreate)
    expect(screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }))
      .toHaveAttribute('data-step-by-step-tour-target', STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyPipeline)
    expect(screen.getByRole('link', { name: /dataset\.connectDataset/ }))
      .toHaveAttribute('data-step-by-step-tour-target', STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyConnect)
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
