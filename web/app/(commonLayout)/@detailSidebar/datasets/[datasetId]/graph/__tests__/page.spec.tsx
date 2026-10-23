import { render, screen } from '@testing-library/react'
import DatasetGraphDetailSidebarSlot from '../page'

vi.mock('../../sidebar-page', () => ({
  DatasetDetailSidebarSlot: () => <nav aria-label="dataset detail sidebar" />,
}))

describe('Dataset knowledge graph sidebar slot', () => {
  it('should keep the dataset detail sidebar on the graph page', () => {
    render(<DatasetGraphDetailSidebarSlot />)

    expect(screen.getByRole('navigation', { name: 'dataset detail sidebar' })).toBeInTheDocument()
  })
})
