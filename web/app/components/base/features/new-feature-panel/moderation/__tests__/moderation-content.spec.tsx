import type { ModerationContentConfig } from '@/models/debug'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ModerationContent from '../moderation-content'

function Harness({
  onChange,
  showPreset = true,
}: {
  onChange: (config: ModerationContentConfig) => void
  showPreset?: boolean
}) {
  const [config, setConfig] = useState<ModerationContentConfig>({
    enabled: false,
    preset_response: '',
  })
  return (
    <ModerationContent
      title="Input moderation"
      showPreset={showPreset}
      config={config}
      onConfigChange={(next) => {
        setConfig(next)
        onChange(next)
      }}
    />
  )
}

describe('ModerationContent', () => {
  it('preserves the edited preset when moderation is disabled and reenabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Input moderation' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(toggle)
    await user.type(screen.getByRole('textbox'), 'Review required')
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, preset_response: 'Review required' })
    expect(screen.getByText('15')).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith({
      enabled: false,
      preset_response: 'Review required',
    })
    await user.click(toggle)
    expect(screen.getByRole('textbox')).toHaveValue('Review required')
  })

  it('limits pasted presets to 100 characters in the field and saved config', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('switch', { name: 'Input moderation' }))
    const preset = screen.getByRole('textbox')
    await user.click(preset)
    await user.paste('a'.repeat(150))
    expect(preset).toHaveValue('a'.repeat(100))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, preset_response: 'a'.repeat(100) })
  })

  it('can enable moderation without exposing a preset when presets are unavailable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} showPreset={false} />)
    await user.click(screen.getByRole('switch', { name: 'Input moderation' }))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, preset_response: '' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
