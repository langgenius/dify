import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InputItem from '../input-item'

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    singleLine,
    onCommit,
  }: {
    value: string
    onChange: (v: string) => void
    singleLine?: boolean
    onCommit?: () => void
  }) => (
    <div data-testid="editor" data-singleline={singleLine ? 'true' : 'false'}>
      <input
        data-testid="editor-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (singleLine && e.key === 'Enter') {
            e.preventDefault()
            onCommit?.()
          }
        }}
      />
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-button', () => ({
  __esModule: true,
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" data-testid="remove" onClick={onClick}>
      remove
    </button>
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (cb: (k: { $: Record<string, string> }) => string) => cb({ $: {} }),
  }),
}))

vi.mock('@langgenius/dify-ui/cn', () => ({
  cn: (...args: unknown[]) => String(args.filter(Boolean).join(' ')),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

const wrap = (overrides: Record<string, unknown> = {}) =>
  render(
    (
      <InputItem nodeId="n1" value="open" onChange={() => {}} hasRemove={false} {...overrides} />
    ) as ReactNode,
  )

describe('http/key-value InputItem singleLine commit', () => {
  it('enables singleLine mode and invokes onCommit when the editor signals Enter', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()

    wrap({ singleLine: true, onCommit })

    const editor = screen.getByTestId('editor')
    expect(editor).toHaveAttribute('data-singleline', 'true')

    const input = screen.getByTestId('editor-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not call onCommit when singleLine is not enabled', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()

    wrap({ onCommit })

    const editor = screen.getByTestId('editor')
    expect(editor).toHaveAttribute('data-singleline', 'false')

    const input = screen.getByTestId('editor-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onCommit).not.toHaveBeenCalled()
  })
})
