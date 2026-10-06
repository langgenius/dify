import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { ChunkingMode } from '@/models/datasets'
import { DocumentContext } from '../../../context'
import { ActionButtons } from '../action-buttons'

function Editor({
  label = 'Chunk content',
  ...props
}: Omit<ComponentProps<typeof ActionButtons>, 'target'> & { label?: string }) {
  const target = useRef<HTMLDivElement>(null)
  return (
    <div ref={target}>
      <textarea aria-label={label} />
      <ActionButtons {...props} target={target} />
    </div>
  )
}

function pressKey(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  fireEvent(target, event)
  fireEvent.keyUp(target, { key, ...options })
  return event
}

describe('ActionButtons', () => {
  it('saves and cancels through the same actions as the buttons inside its editor', () => {
    const handleSave = vi.fn()
    const handleCancel = vi.fn()
    render(<Editor handleSave={handleSave} handleCancel={handleCancel} loading={false} />)
    const input = screen.getByRole('textbox')
    expect(pressKey(input, 's', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(pressKey(input, 'Escape').defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /operation.save/ }))
    fireEvent.click(screen.getByRole('button', { name: /operation.cancel/ }))
    expect(handleSave).toHaveBeenCalledTimes(2)
    expect(handleCancel).toHaveBeenCalledTimes(2)
  })

  it('only handles shortcuts originating inside its own editor', () => {
    const firstSave = vi.fn()
    const secondSave = vi.fn()
    const handleCancel = vi.fn()
    render(
      <>
        <Editor
          label="First chunk"
          handleSave={firstSave}
          handleCancel={handleCancel}
          loading={false}
        />
        <Editor
          label="Second chunk"
          handleSave={secondSave}
          handleCancel={handleCancel}
          loading={false}
        />
        <input aria-label="Outside editor" />
      </>,
    )
    pressKey(screen.getByRole('textbox', { name: 'Second chunk' }), 's', { ctrlKey: true })
    expect(
      pressKey(screen.getByRole('textbox', { name: 'Outside editor' }), 'Escape').defaultPrevented,
    ).toBe(false)
    expect(secondSave).toHaveBeenCalledTimes(1)
    expect(firstSave).not.toHaveBeenCalled()
    expect(handleCancel).not.toHaveBeenCalled()
  })

  it('disables saving from both the button and keyboard while loading', () => {
    const handleSave = vi.fn()
    render(<Editor handleSave={handleSave} handleCancel={vi.fn()} loading />)
    expect(screen.getByRole('button', { name: /operation.save/ })).toBeDisabled()
    expect(pressKey(screen.getByRole('textbox'), 's', { ctrlKey: true }).defaultPrevented).toBe(
      false,
    )
    expect(handleSave).not.toHaveBeenCalled()
  })

  it('ignores composing events and events claimed before they reach the editor', () => {
    const handleSave = vi.fn()
    const handleCancel = vi.fn()
    render(<Editor handleSave={handleSave} handleCancel={handleCancel} loading={false} />)
    const input = screen.getByRole('textbox')
    pressKey(input, 's', { ctrlKey: true, isComposing: true })
    input.addEventListener('keydown', (event) => event.preventDefault(), { once: true })
    pressKey(input, 's', { ctrlKey: true })
    expect(handleSave).not.toHaveBeenCalled()
    expect(handleCancel).not.toHaveBeenCalled()
  })

  it('consumes repeated save keys without repeating the save action', () => {
    const handleSave = vi.fn()
    render(<Editor handleSave={handleSave} handleCancel={vi.fn()} loading={false} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 's', ctrlKey: true })
    const repeatedSave = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(input, repeatedSave)
    expect(repeatedSave.defaultPrevented).toBe(true)
    expect(handleSave).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(input, { key: 's', ctrlKey: true })
    pressKey(input, 's', { ctrlKey: true })
    expect(handleSave).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      actionType: 'edit' as const,
      isChildChunk: false,
      showRegenerationButton: true,
      visible: true,
    },
    {
      actionType: 'add' as const,
      isChildChunk: false,
      showRegenerationButton: true,
      visible: false,
    },
    {
      actionType: 'edit' as const,
      isChildChunk: true,
      showRegenerationButton: true,
      visible: false,
    },
    {
      actionType: 'edit' as const,
      isChildChunk: false,
      showRegenerationButton: false,
      visible: false,
    },
  ])(
    'offers regeneration only for eligible parent chunks: $actionType / $isChildChunk / $showRegenerationButton',
    ({ visible, ...props }) => {
      const handleRegeneration = vi.fn()
      render(
        <DocumentContext.Provider
          value={{ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }}
        >
          <Editor
            {...props}
            handleSave={vi.fn()}
            handleCancel={vi.fn()}
            handleRegeneration={handleRegeneration}
            loading={false}
          />
        </DocumentContext.Provider>,
      )
      const button = screen.queryByRole('button', { name: /operation.saveAndRegenerate/ })
      expect(Boolean(button)).toBe(visible)
      if (button) {
        fireEvent.click(button)
        expect(handleRegeneration).toHaveBeenCalledOnce()
      }
    },
  )
})
