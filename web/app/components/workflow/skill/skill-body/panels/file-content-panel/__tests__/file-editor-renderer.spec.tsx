import type { OnMount } from '@monaco-editor/react'
import { act, render, screen } from '@testing-library/react'

import FileEditorRenderer from '../file-editor-renderer'

const mocks = vi.hoisted(() => ({
  theme: 'light',
  isClient: true,
  loaderConfig: vi.fn(),
  editorProps: [] as Array<Record<string, unknown>>,
  markdownProps: [] as Array<Record<string, unknown>>,
  monacoSetTheme: vi.fn(),
  getFileLanguage: vi.fn((_: string) => 'typescript'),
}))

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: (config: unknown) => mocks.loaderConfig(config),
  },
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mocks.theme }),
}))

vi.mock('@/types/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/app')>()
  return {
    ...actual,
    Theme: { ...actual.Theme, light: 'light', dark: 'dark' },
  }
})

vi.mock('@/utils/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/client')>()
  return {
    ...actual,
    get isClient() {
      return mocks.isClient
    },
  }
})

vi.mock('../../../../utils/file-utils', () => ({
  getFileLanguage: (name: string) => mocks.getFileLanguage(name),
}))

vi.mock('../../../../editor/code-file-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.editorProps.push(props)
    return (
      <button
        type="button"
        onClick={() => (props.onMount as OnMount)({} as Parameters<OnMount>[0], { editor: { setTheme: mocks.monacoSetTheme } } as Parameters<OnMount>[1])}
      >
        mount-code-editor
      </button>
    )
  },
}))

vi.mock('../../../../editor/markdown-file-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.markdownProps.push(props)
    return <div data-testid="markdown-editor">{String(props.value)}</div>
  },
}))

describe('FileEditorRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.theme = 'light'
    mocks.isClient = true
    mocks.editorProps.length = 0
    mocks.markdownProps.length = 0
  })

  it('should render the markdown editor with the collaborative props intact', () => {
    render(
      <FileEditorRenderer
        state={{
          kind: 'editor',
          editor: 'markdown',
          fileTabId: 'file-1',
          fileName: 'SKILL.md',
          content: '# Skill',
          onChange: vi.fn(),
          autoFocus: true,
          onAutoFocus: vi.fn(),
          collaborationEnabled: true,
        }}
      />,
    )

    expect(screen.getByTestId('markdown-editor')).toHaveTextContent('# Skill')
    expect(mocks.markdownProps[0]).toMatchObject({
      instanceId: 'file-1',
      autoFocus: true,
      collaborationEnabled: true,
    })
  })

  it('should render the code editor with the default theme before Monaco mounts', () => {
    render(
      <FileEditorRenderer
        state={{
          kind: 'editor',
          editor: 'code',
          fileTabId: 'file-2',
          fileName: 'main.ts',
          content: 'const a = 1',
          onChange: vi.fn(),
          autoFocus: false,
          onAutoFocus: vi.fn(),
          collaborationEnabled: false,
        }}
      />,
    )

    expect(mocks.editorProps[0]).toMatchObject({
      fileId: 'file-2',
      theme: 'default-theme',
      value: 'const a = 1',
      collaborationEnabled: false,
    })
    expect(mocks.getFileLanguage).toHaveBeenCalledWith('main.ts')
  })

  it('should switch the code editor theme after Monaco mounts in dark mode', () => {
    mocks.theme = 'dark'

    render(
      <FileEditorRenderer
        state={{
          kind: 'editor',
          editor: 'code',
          fileTabId: 'file-3',
          fileName: 'main.ts',
          content: 'const a = 1',
          onChange: vi.fn(),
          autoFocus: false,
          onAutoFocus: vi.fn(),
          collaborationEnabled: true,
        }}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'mount-code-editor' }).click()
    })

    expect(mocks.monacoSetTheme).toHaveBeenCalledWith('vs-dark')
    expect(mocks.editorProps.at(-1)).toMatchObject({
      theme: 'vs-dark',
    })
  })
})
