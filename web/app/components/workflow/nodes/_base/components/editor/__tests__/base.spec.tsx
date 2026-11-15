import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import Base from '../base'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock(
  '@/app/components/app/configuration/config-prompt/prompt-editor-height-resize-wrap',
  () => ({
    default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }),
)

vi.mock('@/app/components/base/file-uploader/file-list-in-log', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-toggle-expend', () => ({
  default: () => ({
    wrapClassName: '',
    wrapStyle: {},
    isExpand: false,
    setIsExpand: vi.fn(),
    editorExpandHeight: 560,
  }),
}))

vi.mock('../../code-generator-button', () => ({
  default: () => null,
}))

vi.mock('../../toggle-expand-btn', () => ({
  default: () => null,
}))

vi.mock('../wrap', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('Base editor', () => {
  it('copies the editor value from its named icon command', async () => {
    const user = userEvent.setup()

    render(
      <Base title="Code" value="const answer = 42" isFocus={false}>
        <div>Editor</div>
      </Base>,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(copy).toHaveBeenCalledWith('const answer = 42')
  })
})
