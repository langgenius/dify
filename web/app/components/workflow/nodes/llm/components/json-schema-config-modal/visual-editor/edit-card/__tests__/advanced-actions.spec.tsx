import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { AdvancedActions } from '../advanced-actions'

function Editor(props: Omit<ComponentProps<typeof AdvancedActions>, 'target'>) {
  const target = useRef<HTMLDivElement>(null)
  return (
    <div ref={target}>
      <input aria-label="Property name" />
      <AdvancedActions {...props} target={target} />
    </div>
  )
}

function submit(target: HTMLElement, options: KeyboardEventInit = {}) {
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

describe('AdvancedActions', () => {
  it('confirms from the property input and the confirm button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Editor onConfirm={onConfirm} onCancel={onCancel} isConfirmDisabled={false} />)
    expect(submit(screen.getByRole('textbox')).defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /operation.confirm/ }))
    fireEvent.click(screen.getByRole('button', { name: /operation.cancel/ }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not submit from outside the property editor or while disabled', () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <Editor onConfirm={onConfirm} onCancel={vi.fn()} isConfirmDisabled={false} />,
    )
    expect(submit(document.body).defaultPrevented).toBe(false)
    rerender(<Editor onConfirm={onConfirm} onCancel={vi.fn()} isConfirmDisabled />)
    expect(screen.getByRole('button', { name: /operation.confirm/ })).toBeDisabled()
    expect(submit(screen.getByRole('textbox')).defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('preserves claimed and IME events', () => {
    const onConfirm = vi.fn()
    render(<Editor onConfirm={onConfirm} onCancel={vi.fn()} isConfirmDisabled={false} />)
    const input = screen.getByRole('textbox')
    expect(submit(input, { isComposing: true }).defaultPrevented).toBe(false)
    input.addEventListener('keydown', (event) => event.preventDefault(), { once: true })
    submit(input)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
