import type { TriggerLogEntity } from '@/app/components/workflow/block-selector/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import LogViewer from '../log-viewer'

const mockWriteText = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value: unknown }) => (
    <div data-testid="code-editor">{JSON.stringify(value)}</div>
  ),
}))

const createLog = (overrides: Partial<TriggerLogEntity> = {}): TriggerLogEntity => ({
  id: 'log-1',
  endpoint: 'https://example.com',
  created_at: '2024-01-01T12:34:56Z',
  request: {
    method: 'POST',
    url: 'https://example.com',
    headers: {
      Host: 'example.com',
      'User-Agent': 'vitest',
      'Content-Length': '0',
      Accept: '*/*',
      'Content-Type': 'application/json',
      'X-Forwarded-For': '127.0.0.1',
      'X-Forwarded-Host': 'example.com',
      'X-Forwarded-Proto': 'https',
      'X-Github-Delivery': '1',
      'X-Github-Event': 'push',
      'X-Github-Hook-Id': '1',
      'X-Github-Hook-Installation-Target-Id': '1',
      'X-Github-Hook-Installation-Target-Type': 'repo',
      'Accept-Encoding': 'gzip',
    },
    data: 'payload=%7B%22foo%22%3A%22bar%22%7D',
  },
  response: {
    status_code: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '2',
    },
    data: '{"ok":true}',
  },
  ...overrides,
})


beforeEach(() => {
  vi.clearAllMocks()
  mockWriteText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
})

describe('LogViewer', () => {
  it('should render nothing when logs are empty', () => {
    const { container } = render(<LogViewer logs={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('expands parsed request and response payloads and collapses them again', async () => {
    const user = userEvent.setup()
    render(<LogViewer logs={[createLog()]} />)

    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )

    const editors = screen.getAllByTestId('code-editor')
    expect(editors.length).toBe(2)
    expect(editors[0]).toHaveTextContent('"foo":"bar"')
    expect(editors[1]).toHaveTextContent('"status_code":200')
    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )
    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
  })

  it('should parse request data when it is raw JSON', async () => {
    const user = userEvent.setup()
    const log = createLog({ request: { ...createLog().request, data: '{"hello":1}' } })

    render(<LogViewer logs={[log]} />)

    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('"hello":1')
  })

  it('should fallback to raw payload when decoding fails', async () => {
    const user = userEvent.setup()
    const log = createLog({ request: { ...createLog().request, data: 'payload=%E0%A4%A' } })

    render(<LogViewer logs={[log]} />)

    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('payload=%E0%A4%A')
  })

  it('should keep request data string when JSON parsing fails', async () => {
    const user = userEvent.setup()
    const log = createLog({ request: { ...createLog().request, data: '{invalid}' } })

    render(<LogViewer logs={[log]} />)

    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('{invalid}')
  })


  it('should render raw response text and allow copying with button feedback', async () => {
    const user = userEvent.setup()
    const rawLog = {
      ...createLog(),
      response: 'plain response',
    } as unknown as TriggerLogEntity

    render(<LogViewer logs={[rawLog]} />)

    await user.click(
      screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }),
    )
    expect(screen.getByText('plain response')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(mockWriteText).toHaveBeenCalledWith('plain response')
    expect(
      await screen.findByRole('button', { name: 'common.operation.copied' }),
    ).toBeInTheDocument()
  })

  it('should render multiple log entries with distinct indices', () => {
    const first = createLog({ id: 'log-1' })
    const second = createLog({ id: 'log-2', created_at: '2024-01-01T12:35:00Z' })

    render(<LogViewer logs={[first, second]} />)

    expect(screen.getByText(/#1/)).toBeInTheDocument()
    expect(screen.getByText(/#2/)).toBeInTheDocument()
  })
})
