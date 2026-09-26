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

  it('keeps the surrounding editor available and retries a failed panel import', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi
      .fn<() => Promise<{ default: ComponentType<EditorProps> }>>()
      .mockRejectedValueOnce(new Error('Chunk unavailable'))
      .mockResolvedValueOnce({ default: Editor })
    const Panel = lazyPanel(load)
    try {
      render(
        <>
          <button type="button">Close panel</button>
          <Panel title="Recovered panel" />
        </>,
      )
      await user.click(await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(await screen.findByRole('textbox', { name: 'Recovered panel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close panel' })).toBeEnabled()
      expect(load).toHaveBeenCalledTimes(2)
    } finally {
      consoleError.mockRestore()
    }
  })

  it.each(['reopen', 'switch'] as const)(
    'retains a successful import retry across a panel %s',
    async (transition) => {
      const user = userEvent.setup()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const load = vi
        .fn<() => Promise<{ default: ComponentType<EditorProps> }>>()
        .mockRejectedValueOnce(new Error('Chunk unavailable'))
        .mockResolvedValue({ default: Editor })
      const Panel = lazyPanel(load)
      try {
        const { rerender } = render(<Panel key="first-node" title="First node" />)
        await user.click(
          await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }),
        )
        expect(await screen.findByRole('textbox', { name: 'First node' })).toBeInTheDocument()

        if (transition === 'reopen') {
          rerender(<div />)
          expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
        }
        const nextTitle = transition === 'reopen' ? 'First node' : 'Second node'
        const nextKey = transition === 'reopen' ? 'first-node' : 'second-node'
        rerender(<Panel key={nextKey} title={nextTitle} />)

        const input = await screen.findByRole('textbox', { name: nextTitle })
        await user.type(input, 'Recovered edit')
        expect(input).toHaveValue('Recovered edit')
        expect(
          screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
        ).not.toBeInTheDocument()
        expect(load).toHaveBeenCalledTimes(2)
      } finally {
        consoleError.mockRestore()
      }
    },
  )
})
