import type { TriggerLogEntity } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LogViewer from './log-viewer'

const mockToastNotify = vi.fn()
const mockWriteText = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (args: { type: string, message: string }) => mockToastNotify(args),
  },
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
      'Host': 'example.com',
      'User-Agent': 'vitest',
      'Content-Length': '0',
      'Accept': '*/*',
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
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: mockWriteText,
    },
    configurable: true,
  })
})

describe('LogViewer', () => {
  it('should render nothing when logs are empty', () => {
    const { container } = render(<LogViewer logs={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('should render collapsed log entries', () => {
    render(<LogViewer logs={[createLog()]} />)

    expect(screen.getByText(/pluginTrigger\.modal\.manual\.logs\.request/)).toBeInTheDocument()
    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
  })

  it('should expand and render request/response payloads', () => {
    render(<LogViewer logs={[createLog()]} />)

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }))

    const editors = screen.getAllByTestId('code-editor')
    expect(editors.length).toBe(2)
    expect(editors[0]).toHaveTextContent('"foo":"bar"')
  })

  it('should collapse expanded content when clicked again', () => {
    render(<LogViewer logs={[createLog()]} />)

    const trigger = screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ })
    fireEvent.click(trigger)
    expect(screen.getAllByTestId('code-editor').length).toBe(2)

    fireEvent.click(trigger)
    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
  })

  it('should render error styling when response is an error', () => {
    render(<LogViewer logs={[createLog({ response: { ...createLog().response, status_code: 500 } })]} />)

    const trigger = screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ })
    const wrapper = trigger.parentElement as HTMLElement

    expect(wrapper).toHaveClass('border-state-destructive-border')
  })

  it('should render raw response text and allow copying', () => {
    const rawLog = {
      ...createLog(),
      response: 'plain response',
    } as unknown as TriggerLogEntity

    render(<LogViewer logs={[rawLog]} />)

    const toggleButton = screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ })
    fireEvent.click(toggleButton)

    expect(screen.getByText('plain response')).toBeInTheDocument()

    const copyButton = screen.getAllByRole('button').find(button => button !== toggleButton)
    expect(copyButton).toBeDefined()
    if (copyButton)
      fireEvent.click(copyButton)
    expect(mockWriteText).toHaveBeenCalledWith('plain response')
    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
  })

  it('should parse request data when it is raw JSON', () => {
    const log = createLog({ request: { ...createLog().request, data: '{\"hello\":1}' } })

    render(<LogViewer logs={[log]} />)

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }))

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('"hello":1')
  })

  it('should fallback to raw payload when decoding fails', () => {
    const log = createLog({ request: { ...createLog().request, data: 'payload=%E0%A4%A' } })

    render(<LogViewer logs={[log]} />)

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }))

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('payload=%E0%A4%A')
  })

  it('should keep request data string when JSON parsing fails', () => {
    const log = createLog({ request: { ...createLog().request, data: '{invalid}' } })

    render(<LogViewer logs={[log]} />)

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.modal\.manual\.logs\.request/ }))

    expect(screen.getAllByTestId('code-editor')[0]).toHaveTextContent('{invalid}')
  })

  it('should render multiple log entries with distinct indices', () => {
    const first = createLog({ id: 'log-1' })
    const second = createLog({ id: 'log-2', created_at: '2024-01-01T12:35:00Z' })

    render(<LogViewer logs={[first, second]} />)

    expect(screen.getByText(/#1/)).toBeInTheDocument()
    expect(screen.getByText(/#2/)).toBeInTheDocument()
  })

  it('should use index-based key when id is missing', () => {
    const log = { ...createLog(), id: '' }

    render(<LogViewer logs={[log]} />)

    expect(screen.getByText(/#1/)).toBeInTheDocument()
  })
})
