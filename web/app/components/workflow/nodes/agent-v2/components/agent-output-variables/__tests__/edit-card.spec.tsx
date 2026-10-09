import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutputEditCard } from '../edit-card'

const state = {
  draft: {
    name: 'summary',
    type: 'string' as const,
    required: false,
    description: '',
    defaultValue: '',
    children: [],
  },
}

function confirmFrom(target: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  fireEvent(target, event)
  fireEvent.keyUp(target, { key: 'Enter', ctrlKey: true })
  return event
}

describe('OutputEditCard keyboard ownership', () => {
  it('submits the actual form from its input and leaves outside shortcuts alone', () => {
    const onConfirm = vi.fn()
    render(
      <OutputEditCard
        state={state}
        existingOutputs={[]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    expect(confirmFrom(document.body).defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
    const form = screen.getByRole('form')
    const name = within(form).getByRole('textbox', {
      name: 'workflowAgent.nodes.agent.outputVars.nameLabel',
    })
    expect(confirmFrom(name).defaultPrevented).toBe(true)
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'summary', type: 'string' }),
      state,
    )
  })

  it('ignores composing submission and disables both paths for an invalid name', () => {
    const onConfirm = vi.fn()
    render(
      <OutputEditCard
        state={state}
        existingOutputs={[]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    const name = screen.getByRole('textbox', {
      name: 'workflowAgent.nodes.agent.outputVars.nameLabel',
    })
    expect(confirmFrom(name, { isComposing: true }).defaultPrevented).toBe(false)
    fireEvent.change(name, { target: { value: 'invalid name' } })
    expect(
      screen.getByRole('button', { name: 'workflowAgent.nodes.agent.outputVars.confirm' }),
    ).toBeDisabled()
    expect(confirmFrom(name).defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes the portalled type selector before cancelling the output form', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <OutputEditCard state={state} existingOutputs={[]} onCancel={onCancel} onConfirm={vi.fn()} />,
    )
    const selector = screen.getByRole('combobox')
    await user.click(selector)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' }),
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
