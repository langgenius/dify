import type { RelatedAppListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Statistics from '../statistics'

vi.mock('@/app/components/base/linked-apps-panel', () => ({
  default: () => <div>linked applications</div>,
}))

vi.mock('../../no-linked-apps-panel', () => ({
  default: () => <div>no linked applications</div>,
}))

describe('Statistics', () => {
  it('shows document and related application counts', () => {
    render(
      <Statistics
        expand
        documentCount={12}
        relatedApps={{ total: 3, data: [] } as RelatedAppListResponse}
      />,
    )

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows linked applications from the related-apps control', async () => {
    const user = userEvent.setup()
    render(
      <Statistics
        expand
        documentCount={12}
        relatedApps={{ total: 1, data: [{ id: 'app-1' }] } as RelatedAppListResponse}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.datasetMenus.relatedApp' }))

    expect(screen.getByText('linked applications')).toBeInTheDocument()
  })

  it('shows an empty state when there are no linked applications', async () => {
    const user = userEvent.setup()
    render(<Statistics expand documentCount={12} relatedApps={{ total: 0, data: [] }} />)

    await user.click(screen.getByRole('button', { name: 'common.datasetMenus.relatedApp' }))

    expect(screen.getByText('no linked applications')).toBeInTheDocument()
  })
})
