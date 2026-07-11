import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugInfo from '../debug-info'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const mockDebugKey = vi.hoisted(() => ({
  data: null as null | { key: string, host: string, port: number },
  isLoading: false,
}))

vi.mock('@/service/use-plugins', () => ({
  useDebugKey: () => mockDebugKey,
}))

vi.mock('../../base/key-value-item', () => ({
  default: ({
    label,
    value,
    maskedValue,
  }: {
    label: string
    value: string
    maskedValue?: string
  }) => (
    <div data-testid={`kv-${label}`}>
      {label}
      :
      {maskedValue || value}
    </div>
  ),
}))

describe('DebugInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDebugKey.data = null
    mockDebugKey.isLoading = false
  })

  it('renders nothing while the debug key is loading', () => {
    mockDebugKey.isLoading = true
    const { container } = render(<DebugInfo />)

    expect(container.innerHTML).toBe('')
  })

  it('renders a disabled trigger when debug info is unavailable', () => {
    render(<DebugInfo />)

    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
  })

  it('uses caller-provided trigger classes without default icon padding', () => {
    render(
      <DebugInfo
        triggerClassName="h-8 w-full py-1 pr-1 pl-2 text-components-menu-item-text"
        triggerContent="Debugging"
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Debugging' })

    expect(trigger).toHaveClass('h-8', 'w-full', 'py-1', 'pr-1', 'pl-2', 'text-components-menu-item-text')
    expect(trigger).not.toHaveClass('p-2', 'text-components-button-secondary-text')
  })

  it('opens a popover with debug metadata and masks the key when info is available', async () => {
    mockDebugKey.data = {
      host: '127.0.0.1',
      port: 5001,
      key: '12345678abcdefghijklmnopqrst87654321',
    }

    const user = userEvent.setup()
    render(<DebugInfo />)

    const trigger = screen.getByRole('button')
    expect(trigger).toBeEnabled()

    // Popover is closed initially — content not rendered yet
    expect(screen.queryByText('plugin.debugInfo.title')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(screen.getByText('plugin.debugInfo.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.debugInfo.title').closest('.w-\\[360px\\]')).toHaveClass('rounded-2xl', 'shadow-2xl')
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://docs.example.com/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin',
    )
    expect(screen.getByTestId('kv-Port')).toHaveTextContent('Port:127.0.0.1:5001')
    expect(screen.getByTestId('kv-Key')).toHaveTextContent('Key:12345678********87654321')
  })
})
