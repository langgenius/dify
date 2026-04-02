import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'

import CodeFileEditor from '../code-file-editor'

const mocks = vi.hoisted(() => {
  const editor = {
    focus: vi.fn(),
  }

  return {
    editor,
    onChange: vi.fn(),
    onMount: vi.fn(),
    onAutoFocus: vi.fn(),
    overlay: null as ReactNode,
    useSkillCodeCursors: vi.fn(),
  }
})

vi.mock('@monaco-editor/react', () => ({
  default: ({
    onMount,
    onChange,
    loading,
  }: {
    onMount: (editor: typeof mocks.editor, monaco: { editor: { setTheme: (theme: string) => void } }) => void
    onChange: (value: string | undefined) => void
    loading: ReactNode
  }) => (
    <div>
      <button type="button" onClick={() => onMount(mocks.editor, { editor: { setTheme: vi.fn() } })}>
        mount-editor
      </button>
      <button type="button" onClick={() => onChange('next value')}>
        change-editor
      </button>
      <div data-testid="editor-loading">{loading}</div>
    </div>
  ),
}))

vi.mock('../code-editor/plugins/remote-cursors', () => ({
  useSkillCodeCursors: (props: unknown) => {
    mocks.useSkillCodeCursors(props)
    return { overlay: mocks.overlay }
  },
}))

describe('CodeFileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.overlay = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  it('should wire Monaco changes and cursor overlay state', () => {
    mocks.overlay = <div data-testid="cursor-overlay">overlay</div>

    render(
      <CodeFileEditor
        language="typescript"
        theme="light"
        value="const a = 1"
        onChange={mocks.onChange}
        onMount={mocks.onMount}
        fileId="file-1"
        collaborationEnabled
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'change-editor' }).click()
    })

    expect(mocks.onChange).toHaveBeenCalledWith('next value')
    expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument()
    expect(mocks.useSkillCodeCursors).toHaveBeenCalledWith({
      editor: null,
      fileId: 'file-1',
      enabled: true,
    })
  })

  it('should focus the editor after mount when auto focus is enabled', () => {
    render(
      <CodeFileEditor
        language="typescript"
        theme="light"
        value="const a = 1"
        onChange={mocks.onChange}
        onMount={mocks.onMount}
        autoFocus
        onAutoFocus={mocks.onAutoFocus}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'mount-editor' }).click()
    })

    expect(mocks.onMount).toHaveBeenCalled()
    expect(mocks.editor.focus).toHaveBeenCalledTimes(1)
    expect(mocks.onAutoFocus).toHaveBeenCalledTimes(1)
  })

  it('should skip auto focus and collaboration overlay in read only mode', () => {
    render(
      <CodeFileEditor
        language="typescript"
        theme="light"
        value="const a = 1"
        onChange={mocks.onChange}
        onMount={mocks.onMount}
        autoFocus
        fileId="file-1"
        collaborationEnabled
        readOnly
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'mount-editor' }).click()
    })

    expect(mocks.editor.focus).not.toHaveBeenCalled()
    expect(mocks.useSkillCodeCursors).toHaveBeenCalledWith({
      editor: null,
      fileId: 'file-1',
      enabled: false,
    })
  })
})
