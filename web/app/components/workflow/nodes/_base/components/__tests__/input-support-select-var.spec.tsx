import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Editor from '../input-support-select-var'

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="prompt-editor">
      <input data-testid="editor-input" defaultValue={value} />
    </div>
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

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/development', () => ({
  Variable02: () => null,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: () => null,
}))

const wrap = (overrides: Record<string, unknown> = {}) =>
  render((<Editor value="open" onChange={() => {}} {...overrides} />) as ReactNode)

describe('input-support-select-var singleLine Enter handling', () => {
  it('commits on Enter when singleLine and no typeahead menu is open', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()

    wrap({ singleLine: true, onCommit })

    const input = screen.getByTestId('editor-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not commit on Enter while the typeahead menu is visible', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()

    // Simulate an open typeahead menu rendered by the component-picker-block plugin.
    document.body.innerHTML =
      '<div data-prompt-editor-typeahead-menu><div data-visible="true"></div></div>'

    wrap({ singleLine: true, onCommit })

    const input = screen.getByTestId('editor-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not commit on Enter when singleLine is disabled', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()

    wrap({ onCommit })

    const input = screen.getByTestId('editor-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onCommit).not.toHaveBeenCalled()
  })
})
