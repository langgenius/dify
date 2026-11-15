import type { AgentConfig } from '@/models/debug'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MAX_ITERATIONS_NUM } from '@/config'
import { AgentStrategy } from '@/types/app'
import { AgentSettingDialog } from '../index'

const basePayload: AgentConfig = {
  enabled: true,
  strategy: AgentStrategy.react,
  max_iteration: 5,
  tools: [],
}

function SettingsFixture({ onSave }: { onSave: (payload: AgentConfig) => void }) {
  const [payload, setPayload] = useState(basePayload)
  return (
    <AgentSettingDialog
      isChatModel
      payload={payload}
      isFunctionCall={false}
      onSave={(value) => {
        setPayload(value)
        onSave(value)
      }}
    />
  )
}

const settingName = 'appDebug.agent.setting.name'

describe('AgentSettingDialog', () => {
  it('discards cancelled edits, submits current iterations, and reopens the saved configuration', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<SettingsFixture onSave={onSave} />)
    const trigger = screen.getByRole('button', { name: settingName })
    await user.click(trigger)
    expect(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeInTheDocument()
    expect(screen.getByText('tools.builtInPromptTitle')).toBeInTheDocument()
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '7')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('spinbutton')).toHaveValue(5)
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '6{Enter}')
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ max_iteration: 6 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    expect(screen.getByRole('spinbutton')).toHaveValue(6)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('clamps iterations and saves the minimum when the number input is cleared', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AgentSettingDialog isChatModel payload={basePayload} isFunctionCall onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: settingName }))
    expect(screen.queryByText('tools.builtInPromptTitle')).not.toBeInTheDocument()
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '999')
    expect(input).toHaveValue(MAX_ITERATIONS_NUM)
    await user.clear(input)
    await user.type(input, '0')
    expect(input).toHaveValue(1)
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ max_iteration: 1 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps readonly settings unavailable', async () => {
    const user = userEvent.setup()
    render(
      <AgentSettingDialog
        isChatModel
        payload={basePayload}
        isFunctionCall
        disabled
        onSave={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: settingName })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
