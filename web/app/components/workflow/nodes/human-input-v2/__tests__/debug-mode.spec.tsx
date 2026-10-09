import type { HumanInputV2DebugMode } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DebugMode from '../components/debug-mode'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from '../types'

const channelLabel = (channel: string) => `workflow.nodes.humanInputV2.debug.channel.${channel}`

describe('Human Input v2 Debug Mode', () => {
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
  it('edits supported channel values and only emits DSL changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const value: HumanInputV2DebugMode = { enabled: false, channels: [] }
    render(<DebugMode value={value} onChange={onChange} readonly={false} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    HUMAN_INPUT_V2_DEBUG_CHANNELS.forEach((channel) => {
      expect(screen.getByRole('checkbox', { name: channelLabel(channel) })).not.toBeChecked()
    })

    await user.click(screen.getByText(channelLabel('feishu')))
    expect(onChange).toHaveBeenCalledWith({ enabled: false, channels: ['feishu'] })

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
