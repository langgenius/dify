import { fireEvent, render, screen } from '@testing-library/react'
import SnippetEmptyState from '../snippet-empty-state'

describe('SnippetEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render empty state copy and create action', () => {
      const handleCreate = vi.fn()

      render(<SnippetEmptyState onCreate={handleCreate} />)

      expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'workflow.tabs.createSnippet' })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCreate when create button is clicked', () => {
      const handleCreate = vi.fn()

      render(<SnippetEmptyState onCreate={handleCreate} />)

      fireEvent.click(screen.getByRole('button', { name: 'workflow.tabs.createSnippet' }))

      expect(handleCreate).toHaveBeenCalledTimes(1)
    })
  })
})
