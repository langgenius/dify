import type { Memory } from '../../../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import MemoryConfig from '../memory-config'

function MemorySettings({ readonly = false, onChange = (_memory?: Memory) => {} }) {
  const [memory, setMemory] = useState<Memory | undefined>({
    window: { enabled: true, size: 50 },
    query_prompt_template: '{{#sys.query#}}',
    role_prefix: { user: 'Human', assistant: 'Assistant' },
  })
  return (
    <MemoryConfig
      config={{ data: memory }}
      readonly={readonly}
      canSetRoleName
      onChange={(value) => {
        setMemory(value)
        onChange(value)
      }}
    />
  )
}

describe('memory settings', () => {
  it('keeps a valid window while clearing, and synchronizes integer edits with the slider', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MemorySettings onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'workflow.nodes.common.memory.windowSize' })
    const slider = screen.getByRole('slider', { name: 'workflow.nodes.common.memory.windowSize' })

    await user.clear(input)
    expect(onChange).not.toHaveBeenCalled()
    await user.tab()
    expect(input).toHaveValue('50')

    await user.clear(input)
    await user.type(input, '8.9')
    await user.tab()
    expect(input).toHaveValue('9')
    expect(slider).toHaveAttribute('aria-valuenow', '9')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ window: { enabled: true, size: 9 } }),
    )

    await user.click(slider)
    await user.keyboard('{ArrowRight}')
    expect(input).toHaveValue('10')
  })

  it('clamps the window to its business limit without changing the role prefixes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MemorySettings onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'workflow.nodes.common.memory.windowSize' })
    await user.clear(input)
    await user.type(input, '999')
    await user.tab()
    expect(input).toHaveValue('100')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        window: { enabled: true, size: 100 },
        role_prefix: { user: 'Human', assistant: 'Assistant' },
      }),
    )
  })

  it('connects role labels to editable inputs and preserves readonly settings', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<MemorySettings />)
    const input = screen.getByRole('textbox', { name: 'workflow.nodes.common.memory.user' })
    await user.click(screen.getByText('workflow.nodes.common.memory.user'))
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'User')
    expect(input).toHaveValue('User')

    rerender(<MemorySettings readonly />)
    await user.type(input, ' changed')
    expect(input).toHaveValue('User')
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.common.memory.windowSize' }),
    ).toBeDisabled()
  })
})
