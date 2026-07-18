import type { HumanInputV2DebugMode } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DebugMode from '../components/debug-mode'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from '../types'

const channelLabel = (channel: string) => `workflow.nodes.humanInputV2.debug.channel.${channel}`

describe('Human Input v2 Debug Mode', () => {
  it('edits all six channel values and only emits DSL changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const value: HumanInputV2DebugMode = { enabled: false, channels: [] }
    render(<DebugMode value={value} onChange={onChange} readonly={false} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    HUMAN_INPUT_V2_DEBUG_CHANNELS.forEach((channel) => {
      expect(screen.getByText(channelLabel(channel))).toBeInTheDocument()
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
      screen.getByText(`${channelLabel('email')}, ${channelLabel('slack')}`),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('switch', { name: 'workflow.nodes.humanInputV2.debug.toggle' }),
    )
    expect(onChange).not.toHaveBeenCalled()
  })
})
