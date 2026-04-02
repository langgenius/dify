import { act, render, screen } from '@testing-library/react'
import ReadOnlyCodePreview from '../read-only-code-preview'

const mocks = vi.hoisted(() => ({
  theme: 'light',
  loaderConfig: vi.fn(),
  editorProps: [] as Array<Record<string, unknown>>,
  monacoSetTheme: vi.fn(),
}))

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: (config: unknown) => mocks.loaderConfig(config),
  },
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mocks.theme }),
}))

vi.mock('@/types/app', () => ({
  Theme: { light: 'light', dark: 'dark' },
  AgentStrategy: { functionCall: 'functionCall' },
}))

vi.mock('../../editor/code-file-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.editorProps.push(props)
    return (
      <button
        type="button"
        onClick={() => (props.onMount as (editor: unknown, monaco: { editor: { setTheme: (theme: string) => void } }) => void)({}, { editor: { setTheme: mocks.monacoSetTheme } })}
      >
        mount-read-only-editor
      </button>
    )
  },
}))
describe('ReadOnlyCodePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.theme = 'light'
    mocks.editorProps.length = 0
  })

  it('should render with the default theme until Monaco mounts', () => {
    render(<ReadOnlyCodePreview value="const a = 1" language="typescript" />)

    expect(mocks.editorProps[0]).toMatchObject({
      value: 'const a = 1',
      language: 'typescript',
      theme: 'default-theme',
      readOnly: true,
    })
  })

  it('should resolve the light Monaco theme when mounted in light mode', () => {
    render(<ReadOnlyCodePreview value="const a = 1" language="typescript" />)

    act(() => {
      screen.getByRole('button', { name: 'mount-read-only-editor' }).click()
    })

    expect(mocks.monacoSetTheme).toHaveBeenCalledWith('light')
    expect(mocks.editorProps.at(-1)).toMatchObject({
      theme: 'light',
    })
  })

  it('should switch to the resolved Monaco theme after mount', () => {
    mocks.theme = 'dark'

    render(<ReadOnlyCodePreview value="const a = 1" language="typescript" />)

    act(() => {
      screen.getByRole('button', { name: 'mount-read-only-editor' }).click()
    })

    expect(mocks.monacoSetTheme).toHaveBeenCalledWith('vs-dark')
    expect(mocks.editorProps.at(-1)).toMatchObject({
      theme: 'vs-dark',
    })
  })

  it('should expose a stable no-op change handler', () => {
    render(<ReadOnlyCodePreview value="const a = 1" language="typescript" />)

    expect(() => (mocks.editorProps[0].onChange as () => void)()).not.toThrow()
  })

  it('should skip Monaco path configuration when window is unavailable at import time', async () => {
    const originalWindow = globalThis.window

    vi.resetModules()
    mocks.loaderConfig.mockClear()
    vi.stubGlobal('window', undefined)

    const readOnlyCodePreviewModule = await import('../read-only-code-preview')
    const FreshReadOnlyCodePreview = readOnlyCodePreviewModule.default

    vi.stubGlobal('window', originalWindow)
    mocks.editorProps.length = 0

    render(<FreshReadOnlyCodePreview value="const a = 1" language="typescript" />)

    expect(mocks.loaderConfig).not.toHaveBeenCalled()
  })

  it('should configure Monaco asset paths when window is available at import time', async () => {
    const originalWindow = globalThis.window

    vi.resetModules()
    mocks.loaderConfig.mockClear()
    vi.stubGlobal('window', {
      location: { origin: 'https://example.com' },
    })

    await import('../read-only-code-preview')

    expect(mocks.loaderConfig).toHaveBeenCalledWith(expect.objectContaining({
      paths: expect.objectContaining({
        vs: expect.stringContaining('https://example.com'),
      }),
    }))

    vi.stubGlobal('window', originalWindow)
  })
})
