import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdvancedSetting from '../advanced-setting'

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: ({
    title,
    value,
    onChange,
  }: {
    title: React.ReactNode
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div>{typeof title === 'string' ? title : 'editor-title'}</div>
      <input
        aria-label="instruction-input"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (value: { enabled: boolean }) => void
  }) => <button type="button" onClick={() => onChange({ enabled: true })}>memory-config</button>,
}))

describe('question-classifier/advanced-setting', () => {
  it('updates the instruction and exposes memory config when memory is enabled', async () => {
    const user = userEvent.setup()
    const onInstructionChange = vi.fn()
    const onMemoryChange = vi.fn()

    render(
      <AdvancedSetting
        instruction="Route by topic"
        onInstructionChange={onInstructionChange}
        hideMemorySetting={false}
        onMemoryChange={onMemoryChange}
        isChatModel
        isChatApp
        nodesOutputVars={[]}
        availableNodes={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText('instruction-input'), {
      target: { value: 'Route by topic!' },
    })
    await user.click(screen.getByRole('button', { name: 'memory-config' }))

    expect(onInstructionChange).toHaveBeenCalledWith('Route by topic!')
    expect(onMemoryChange).toHaveBeenCalledWith({ enabled: true })
  })

  it('hides the memory setting when the section is disabled', () => {
    render(
      <AdvancedSetting
        instruction="Route by topic"
        onInstructionChange={vi.fn()}
        hideMemorySetting
        onMemoryChange={vi.fn()}
        isChatModel
        isChatApp
        nodesOutputVars={[]}
        availableNodes={[]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'memory-config' })).not.toBeInTheDocument()
  })
})
