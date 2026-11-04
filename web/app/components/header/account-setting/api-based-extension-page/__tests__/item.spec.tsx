import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { Item } from '../item'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

describe('Item Component', () => {
  const mockData: ApiBasedExtensionResponse = {
    id: '1',
    name: 'Test Extension',
    api_endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  }
  const mockOnEdit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    request.mockImplementation(() => Promise.resolve(Response.json({ result: 'success' })))
  })

  describe('Rendering', () => {
    it('should distinguish the edit and delete buttons for each extension by name', () => {
      render(
        <>
          <Item apiBasedExtension={mockData} onEdit={mockOnEdit} />
          <Item
            apiBasedExtension={{ ...mockData, id: '2', name: 'Another Extension' }}
            onEdit={mockOnEdit}
          />
        </>,
      )

      expect(
        screen.getByRole('button', { name: /common\.operation\.edit.*Test Extension/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /common\.operation\.delete.*Test Extension/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /common\.operation\.edit.*Another Extension/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /common\.operation\.delete.*Another Extension/i }),
      ).toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should request editing with the current extension when clicking edit button', async () => {
      const user = userEvent.setup()
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      await user.click(screen.getByText('common.operation.edit'))

      expect(mockOnEdit).toHaveBeenCalledWith(mockData)
    })

    it('should not open edit or delete flows when management is not allowed', async () => {
      const user = userEvent.setup()
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} canManage={false} />)
      await user.click(screen.getByText('common.operation.edit'))
      await user.click(screen.getByText('common.operation.delete'))

      expect(
        screen.getByRole('button', { name: /common\.operation\.edit.*Test Extension/i }),
      ).toBeDisabled()
      expect(mockOnEdit).not.toHaveBeenCalled()
      expect(
        screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i),
      ).not.toBeInTheDocument()
    })
  })

  describe('Deletion', () => {
    it('should call delete mutation when confirming deletion', async () => {
      const user = userEvent.setup()
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)

      await user.click(screen.getByText('common.operation.delete'))
      const dialog = screen.getByRole('alertdialog', {
        name: /common\.operation\.delete.*Test Extension.*\?/i,
      })
      const confirmButton = within(dialog).getByRole('button', { name: 'common.operation.delete' })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1)
        const sent = request.mock.calls[0]![2].request as Request
        expect(sent.method).toBe('DELETE')
        expect(new URL(sent.url).pathname).toMatch(/\/api-based-extension\/1$/)
      })
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    })

    it('should close delete confirmation when clicking cancel button', async () => {
      const user = userEvent.setup()
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      await user.click(screen.getByText('common.operation.delete'))
      await user.click(screen.getByText('common.operation.cancel'))
      expect(request).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(
          screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i),
        ).not.toBeInTheDocument()
      })
    })
  })
})
