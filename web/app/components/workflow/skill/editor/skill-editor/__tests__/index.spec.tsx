import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import SkillEditor from '../index'

const mocks = vi.hoisted(() => {
  const rootElement = document.createElement('div')
  rootElement.focus = vi.fn()

  return {
    initialConfig: null as Record<string, unknown> | null,
    filePreviewValues: [] as Array<Record<string, unknown>>,
    onBlurProps: [] as Array<Record<string, unknown>>,
    updateBlockProps: [] as Array<Record<string, unknown>>,
    localCursorProps: [] as Array<Record<string, unknown>>,
    remoteCursorProps: [] as Array<Record<string, unknown>>,
    toolPickerScopes: [] as string[],
    onChangeCalls: 0,
    rootElement,
    editor: {
      focus: (callback: () => void) => callback(),
      getRootElement: () => rootElement,
    },
  }
})

vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ initialConfig, children }: { initialConfig: Record<string, unknown>, children: React.ReactNode }) => {
    mocks.initialConfig = initialConfig
    return <div data-testid="lexical-composer">{children}</div>
  },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mocks.editor],
}))

vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: (props: Record<string, unknown>) => <div data-testid="content-editable">{JSON.stringify(props)}</div>,
}))

vi.mock('@lexical/react/LexicalRichTextPlugin', () => ({
  RichTextPlugin: ({ contentEditable, placeholder }: { contentEditable: React.ReactNode, placeholder: React.ReactNode }) => (
    <div data-testid="rich-text-plugin">
      {contentEditable}
      {placeholder}
    </div>
  ),
}))

vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: { onChange: (editorState: { read: (reader: () => unknown) => unknown }) => void }) => {
    React.useEffect(() => {
      if (mocks.onChangeCalls === 0) {
        mocks.onChangeCalls += 1
        onChange({
          read: reader => reader(),
        })
      }
    }, [onChange])
    return <div data-testid="on-change-plugin" />
  },
}))

vi.mock('@lexical/react/LexicalErrorBoundary', () => ({
  LexicalErrorBoundary: () => <div data-testid="error-boundary" />,
}))

vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({
  HistoryPlugin: () => <div data-testid="history-plugin" />,
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $getRoot: () => ({
      getChildren: () => [
        { getTextContent: () => 'first line' },
        { getTextContent: () => 'second line' },
      ],
    }),
  }
})

vi.mock('@/app/components/base/prompt-editor/plugins/placeholder', () => ({
  default: ({ value }: { value: React.ReactNode }) => <div data-testid="placeholder">{value}</div>,
}))

vi.mock('@/app/components/base/prompt-editor/plugins/on-blur-or-focus-block', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.onBlurProps.push(props)
    return <div data-testid="on-blur-block" />
  },
}))

vi.mock('@/app/components/base/prompt-editor/plugins/update-block', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.updateBlockProps.push(props)
    return <div data-testid="update-block" />
  },
}))

vi.mock('@/app/components/base/prompt-editor/utils', () => ({
  textToEditorState: (value: string) => `editor-state:${value}`,
}))

vi.mock('../plugins/file-picker-block', () => ({
  default: () => <div data-testid="file-picker-block" />,
}))

vi.mock('../plugins/file-reference-block/preview-context', () => ({
  FilePreviewContextProvider: ({ value, children }: { value: Record<string, unknown>, children: React.ReactNode }) => {
    mocks.filePreviewValues.push(value)
    return <div data-testid="file-preview-context">{children}</div>
  },
}))

vi.mock('../plugins/file-reference-block/replacement-block', () => ({
  default: () => <div data-testid="file-reference-replacement-block" />,
}))

vi.mock('../plugins/remote-cursors', () => ({
  LocalCursorPlugin: (props: Record<string, unknown>) => {
    mocks.localCursorProps.push(props)
    return <div data-testid="local-cursor-plugin" />
  },
  SkillRemoteCursors: (props: Record<string, unknown>) => {
    mocks.remoteCursorProps.push(props)
    return <div data-testid="remote-cursor-plugin" />
  },
}))

vi.mock('../plugins/tool-block', () => ({
  ToolBlock: () => <div data-testid="tool-block-plugin" />,
  ToolBlockNode: class MockToolBlockNode {},
  ToolBlockReplacementBlock: () => <div data-testid="tool-block-replacement-block" />,
  ToolGroupBlockNode: class MockToolGroupBlockNode {},
  ToolGroupBlockReplacementBlock: () => <div data-testid="tool-group-block-replacement-block" />,
}))

vi.mock('../plugins/tool-block/tool-picker-block', () => ({
  default: ({ scope }: { scope: string }) => {
    mocks.toolPickerScopes.push(scope)
    return <div data-testid="tool-picker-block">{scope}</div>
  },
}))

beforeEach(() => {
  mocks.initialConfig = null
  mocks.filePreviewValues.length = 0
  mocks.onBlurProps.length = 0
  mocks.updateBlockProps.length = 0
  mocks.localCursorProps.length = 0
  mocks.remoteCursorProps.length = 0
  mocks.toolPickerScopes.length = 0
  mocks.onChangeCalls = 0
  vi.mocked(mocks.rootElement.focus).mockClear()
})

describe('SkillEditor', () => {
  it('should build the lexical config and render editable plugins', async () => {
    const onChange = vi.fn()
    const onAutoFocus = vi.fn()

    render(
      <SkillEditor
        instanceId="file-1"
        value="hello"
        editable
        autoFocus
        collaborationEnabled
        toolPickerScope="selection"
        placeholder="Type here"
        onChange={onChange}
        onAutoFocus={onAutoFocus}
      />,
    )

    expect(mocks.initialConfig).toMatchObject({
      namespace: 'skill-editor',
      editable: true,
      editorState: 'editor-state:hello',
    })
    expect(mocks.filePreviewValues[0]).toEqual({ enabled: false })
    expect(screen.getByTestId('file-picker-block')).toBeInTheDocument()
    expect(screen.getByTestId('tool-picker-block')).toHaveTextContent('selection')
    expect(mocks.toolPickerScopes).toEqual(['selection'])
    expect(mocks.updateBlockProps[0]).toMatchObject({ instanceId: 'file-1' })
    expect(mocks.localCursorProps[0]).toMatchObject({ fileId: 'file-1', enabled: true })
    expect(mocks.remoteCursorProps[0]).toMatchObject({ fileId: 'file-1', enabled: true })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('first line\nsecond line')
    })
    await waitFor(() => {
      expect(onAutoFocus).toHaveBeenCalledTimes(1)
    })
    expect(mocks.rootElement.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('should skip editable-only plugins in readonly mode', () => {
    render(
      <SkillEditor
        instanceId="file-2"
        value="readonly"
        editable={false}
        collaborationEnabled={false}
      />,
    )

    expect(mocks.initialConfig).toMatchObject({
      editable: false,
      editorState: 'editor-state:readonly',
    })
    expect(screen.queryByTestId('file-picker-block')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tool-picker-block')).not.toBeInTheDocument()
    expect(mocks.localCursorProps[0]).toMatchObject({ fileId: 'file-2', enabled: false })
    expect(mocks.remoteCursorProps[0]).toMatchObject({ fileId: 'file-2', enabled: false })
  })
})
