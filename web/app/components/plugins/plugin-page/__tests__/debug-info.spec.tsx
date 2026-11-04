import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import DebugInfo from '../debug-info'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const debugKey = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.debuggingKey.get': debugKey,
    }),
  }
})

describe('DebugInfo', () => {
  beforeEach(() => {
    debugKey.mockResolvedValue(null)
  })

  it('renders nothing while the debug key is loading', () => {
    debugKey.mockReturnValue(new Promise(() => {}))
    const { container } = render(<DebugInfo />)

    expect(container.innerHTML).toBe('')
  })

  it('renders a disabled trigger when debug info is unavailable', async () => {
    render(<DebugInfo />)

    const trigger = await screen.findByRole('button', { name: 'plugin.debugInfo.title' })
    expect(trigger).toBeDisabled()
  })

  it('opens a popover with debug metadata and masks the key when info is available', async () => {
    debugKey.mockResolvedValue({
      host: '127.0.0.1',
      port: 5001,
      key: '12345678abcdefghijklmnopqrst87654321',
    })

    const user = userEvent.setup()
    render(<DebugInfo />)

    const trigger = await screen.findByRole('button', { name: 'plugin.debugInfo.title' })
    expect(trigger).toBeEnabled()

    // Popover is closed initially — content not rendered yet
    expect(screen.queryByText('plugin.debugInfo.title')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(screen.getByText('plugin.debugInfo.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.debugInfo.viewDocs' })).toHaveAttribute(
      'href',
      'https://docs.example.com/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin',
    )
    expect(screen.getByRole('group', { name: 'Port' })).toHaveTextContent('127.0.0.1:5001')
    expect(screen.getByRole('group', { name: 'Key' })).toHaveTextContent('12345678********87654321')
    expect(screen.queryByText('12345678abcdefghijklmnopqrst87654321')).not.toBeInTheDocument()
  })
})
