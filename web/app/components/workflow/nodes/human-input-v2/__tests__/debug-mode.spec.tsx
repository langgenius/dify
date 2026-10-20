import type { ChannelSummary } from '@dify/contracts/api/console/workspace/types.gen'
import type { ReactNode } from 'react'
import type { HumanInputV2DebugMode } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as renderUI, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import DebugMode from '../components/debug-mode'
import { createChannelsQueryClient } from './channel-fixtures'

const channelLabel = (channel: string) => `workflow.nodes.humanInputV2.debug.channel.${channel}`
const render = (
  ui: ReactNode,
  providers?: ChannelSummary['provider'][],
  queryClient = createChannelsQueryClient(providers),
) => {
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('Human Input v2 Debug Mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('only offers channels configured in the current workspace', async () => {
    const user = userEvent.setup()
    render(
      <DebugMode value={{ enabled: false, channels: [] }} onChange={vi.fn()} readonly={false} />,
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )

    expect(screen.getByRole('checkbox', { name: channelLabel('email') })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: channelLabel('slack') })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: channelLabel('feishu') })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('shows the real email and prevents clearing the final selected channel with an explanatory tooltip', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DebugMode
        value={{ enabled: true, channels: ['email'] }}
        onChange={onChange}
        readonly={false}
        email="reviewer@example.com"
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    const checkbox = screen.getByRole('checkbox', { name: channelLabel('email') })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('reviewer@example.com')).toBeInTheDocument()
    await user.click(screen.getByText(channelLabel('email')))
    expect(onChange).not.toHaveBeenCalled()
    await user.unhover(screen.getByText(channelLabel('email')))
    await user.hover(checkbox)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'workflow.nodes.humanInputV2.debug.keepOneChannel',
    )
    await user.click(screen.getByRole('checkbox', { name: channelLabel('slack') }))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, channels: ['email', 'slack'] })
  })

  it('protects the last configured selection even when the imported node retains an unconfigured channel', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DebugMode
        value={{ enabled: true, channels: ['email', 'feishu'] }}
        onChange={onChange}
        readonly={false}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    expect(screen.getByRole('checkbox', { name: channelLabel('email') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('checkbox', { name: channelLabel('feishu') })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: channelLabel('email') })).toBeInTheDocument()
    await user.click(screen.getByText(channelLabel('email')))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows no selectable channels when none are configured and does not change the node', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DebugMode value={{ enabled: false, channels: [] }} onChange={onChange} readonly={false} />,
      [],
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'workflow.nodes.humanInputV2.template.notConfigured',
    )
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not fall back to all channels after a load failure and can retry', async () => {
    const user = userEvent.setup()
    const queryKey =
      consoleQuery.workspace.current.humanInput.v2.channels.get.queryOptions().queryKey
    const response = createChannelsQueryClient().getQueryData(queryKey)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } }),
      )
    render(
      <DebugMode value={{ enabled: false, channels: [] }} onChange={vi.fn()} readonly={false} />,
      undefined,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'contacts.imPlatform.loadError.title',
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByRole('checkbox', { name: channelLabel('slack') })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
  it('edits supported channel values and only emits DSL changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const value: HumanInputV2DebugMode = { enabled: false, channels: [] }
    render(<DebugMode value={value} onChange={onChange} readonly={false} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    for (const channel of ['email', 'slack']) {
      expect(screen.getByRole('checkbox', { name: channelLabel(channel) })).not.toBeChecked()
    }

    await user.click(screen.getByText(channelLabel('slack')))
    expect(onChange).toHaveBeenCalledWith({ enabled: false, channels: ['slack'] })

    await user.click(
      screen.getByRole('switch', { name: 'workflow.nodes.humanInputV2.debug.toggle' }),
    )
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, channels: [] })
  })

  it('shows enabled-without-channel and imported compatibility errors', () => {
    const { rerender } = render(
      <DebugMode value={{ enabled: true, channels: [] }} onChange={vi.fn()} readonly={false} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputV2.error.debugChannelRequired',
    )

    rerender(
      <DebugMode
        value={{ enabled: false, channels: ['email', 'legacy_channel'] } as HumanInputV2DebugMode}
        onChange={vi.fn()}
        readonly={false}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputV2.debug.unsupported',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('legacy_channel')
  })

  it('is non-mutating in read-only mode and preserves selected channels while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DebugMode
        value={{ enabled: false, channels: ['email', 'slack'] }}
        onChange={onChange}
        readonly
      />,
    )

    expect(
      screen.getByRole('img', { name: `${channelLabel('email')}, ${channelLabel('slack')}` }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('switch', { name: 'workflow.nodes.humanInputV2.debug.toggle' }),
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts an imported Lark selection and lets the user toggle it without losing Email', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <DebugMode
        value={{ enabled: true, channels: ['lark', 'email'] }}
        onChange={onChange}
        readonly={false}
      />,
      ['resend', 'lark'],
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: `${channelLabel('lark')}, ${channelLabel('email')}` }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    expect(screen.getByRole('checkbox', { name: channelLabel('lark') })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: channelLabel('lark') }))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, channels: ['email'] })
    rerender(
      <DebugMode
        value={{ enabled: true, channels: ['email'] }}
        onChange={onChange}
        readonly={false}
      />,
    )
    expect(screen.getByRole('img', { name: channelLabel('email') })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: channelLabel('lark') }))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, channels: ['email', 'lark'] })
  })
})
