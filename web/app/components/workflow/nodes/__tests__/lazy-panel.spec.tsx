import type { ComponentType } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { lazyPanel } from '../lazy-panel'

type EditorProps = { title: string }
function Editor({ title }: EditorProps) {
  const [draft, setDraft] = useState('')
  return (
    <label>
      {title}
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
    </label>
  )
}

function deferredPanel() {
  let resolve!: (value: { default: ComponentType<EditorProps> }) => void
  const promise = new Promise<{ default: ComponentType<EditorProps> }>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('lazy node panels', () => {
  it('loads only when selected and preserves an unsaved edit when node props update', async () => {
    const user = userEvent.setup()
    const pending = deferredPanel()
    const load = vi.fn(() => pending.promise)
    const Panel = lazyPanel(load)
    const { rerender } = render(<div />)
    expect(load).not.toHaveBeenCalled()

    rerender(<Panel title="Prompt" />)
    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    await act(async () => pending.resolve({ default: Editor }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Unsaved prompt')

    rerender(<Panel title="Updated prompt" />)
    expect(screen.getByRole('textbox', { name: 'Updated prompt' })).toHaveValue('Unsaved prompt')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not replace the selected panel when a previous selection finishes loading', async () => {
    const first = deferredPanel()
    const second = deferredPanel()
    const FirstPanel = lazyPanel(() => first.promise)
    const SecondPanel = lazyPanel(() => second.promise)
    const { rerender } = render(<FirstPanel title="First node" />)

    rerender(<SecondPanel title="Second node" />)
    await act(async () => second.resolve({ default: Editor }))
    expect(screen.getByRole('textbox', { name: 'Second node' })).toBeInTheDocument()
    await act(async () => first.resolve({ default: Editor }))
    expect(screen.queryByRole('textbox', { name: 'First node' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Second node' })).toBeInTheDocument()
  })

  it('offers an explicit reload for an import failure without reloading automatically', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const Panel = lazyPanel<EditorProps>(() => Promise.reject(new Error('Chunk unavailable')))
    try {
      const { rerender } = render(
        <>
          <button type="button">Close panel</button>
          <Panel title="Unavailable panel" />
        </>,
      )
      const reloadButton = await screen.findByRole('button', {
        name: 'common.errorBoundary.reloadPage',
      })
      expect(
        screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close panel' })).toBeEnabled()
      expect(reload).not.toHaveBeenCalled()
      await user.click(reloadButton)
      expect(reload).toHaveBeenCalledTimes(1)

      rerender(<div />)
      rerender(<Panel title="Unavailable panel" />)
      expect(
        await screen.findByRole('button', { name: 'common.errorBoundary.reloadPage' }),
      ).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
      ).not.toBeInTheDocument()
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      reload.mockRestore()
      consoleError.mockRestore()
    }
  })

  it('retries a render failure locally and keeps the imported panel usable after reopening', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const load = vi.fn(async () => ({
      default: ({ broken, ...props }: EditorProps & { broken: boolean }) => {
        if (broken) throw new Error('Render unavailable')
        return <Editor {...props} />
      },
    }))
    const Panel = lazyPanel(load)
    try {
      const { rerender } = render(<Panel title="Recovered panel" broken />)
      await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' })
      rerender(<Panel title="Recovered panel" broken={false} />)
      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(await screen.findByRole('textbox', { name: 'Recovered panel' })).toBeInTheDocument()
      expect(reload).not.toHaveBeenCalled()

      rerender(<div />)
      rerender(<Panel title="Reopened panel" broken={false} />)
      const input = await screen.findByRole('textbox', { name: 'Reopened panel' })
      await user.type(input, 'Recovered edit')
      expect(input).toHaveValue('Recovered edit')
      expect(load).toHaveBeenCalledTimes(1)
    } finally {
      reload.mockRestore()
      consoleError.mockRestore()
    }
  })
})
