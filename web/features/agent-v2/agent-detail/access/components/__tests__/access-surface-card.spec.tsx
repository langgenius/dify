import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessSurfaceCard } from '../access-surface-card'

const mockCopy = vi.fn()
let mockCopied = false

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copied: mockCopied,
    copy: mockCopy,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('AccessSurfaceCard', () => {
  beforeEach(() => {
    mockCopied = false
    vi.clearAllMocks()
  })

  describe('Copy feedback', () => {
    it('should expose the surface card by its title', () => {
      render(
        <AccessSurfaceCard
          title="Web app"
          icon="i-ri-window-line"
          iconClassName="bg-state-accent-solid"
          endpointLabel="Access URL"
          endpoint="https://chat.example.test/agent/token"
          enabled
          onEnabledChange={vi.fn()}
          copyLabel="Copy access URL"
        >
          <button type="button">Action</button>
        </AccessSurfaceCard>,
      )

      expect(screen.getByRole('article', { name: 'Web app' })).toBeInTheDocument()
    })

    it('should copy the endpoint and render copied state from the clipboard hook', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <AccessSurfaceCard
          title="Web app"
          icon="i-ri-window-line"
          iconClassName="bg-state-accent-solid"
          endpointLabel="Access URL"
          endpoint="https://chat.example.test/agent/token"
          enabled
          onEnabledChange={vi.fn()}
          copyLabel="Copy access URL"
        >
          <button type="button">Action</button>
        </AccessSurfaceCard>,
      )

      await user.click(screen.getByRole('button', { name: 'Copy access URL' }))

      expect(mockCopy).toHaveBeenCalledWith('https://chat.example.test/agent/token')

      mockCopied = true
      rerender(
        <AccessSurfaceCard
          title="Web app"
          icon="i-ri-window-line"
          iconClassName="bg-state-accent-solid"
          endpointLabel="Access URL"
          endpoint="https://chat.example.test/agent/token"
          enabled
          onEnabledChange={vi.fn()}
          copyLabel="Copy access URL"
        >
          <button type="button">Action</button>
        </AccessSurfaceCard>,
      )

      expect(screen.getByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
    })
  })
})
