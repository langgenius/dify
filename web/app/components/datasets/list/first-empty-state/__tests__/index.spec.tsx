import { render, screen } from '@testing-library/react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import DatasetFirstEmptyState from '..'

describe('DatasetFirstEmptyState', () => {
  it('links to pipeline creation when creation is available', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    expect(
      screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).toHaveAttribute('href', '/datasets/create-from-pipeline')
  })

  it('exposes step-by-step tour targets for the empty knowledge actions', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset canCreateDataset />)

    expect(screen.getByRole('link', { name: /dataset\.firstEmpty\.createTitle/ })).toHaveAttribute(
      'data-step-by-step-tour-target',
      STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyCreate,
    )
    expect(
      screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).toHaveAttribute(
      'data-step-by-step-tour-target',
      STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyPipeline,
    )
    expect(screen.getByRole('link', { name: /dataset\.connectDataset/ })).toHaveAttribute(
      'data-step-by-step-tour-target',
      STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyConnect,
    )
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

  it('shows a permission message when no empty-state action is available', () => {
    render(<DatasetFirstEmptyState canConnectExternalDataset={false} canCreateDataset={false} />)

    expect(screen.getByText('dataset.firstEmpty.noCreatePermission')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
