import { fireEvent, render, screen } from '@testing-library/react'
import { CLEAR_HIDE_MENU_TIMEOUT } from '../plugins/workflow-variable-block'
import SandboxPlaceholder from '../sandbox-placeholder'

const mocks = vi.hoisted(() => {
  const selectEnd = vi.fn()
  const insertNodes = vi.fn()
  const createTextNode = vi.fn((text: string) => ({ text }))
  const editor = {
    focus: vi.fn((callback?: () => void) => callback?.()),
    update: vi.fn((callback: () => void) => callback()),
    dispatchCommand: vi.fn(),
  }

  return {
    createTextNode,
    editor,
    insertNodes,
    selectEnd,
  }
})

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mocks.editor],
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $getRoot: () => ({
      selectEnd: mocks.selectEnd,
    }),
    $insertNodes: mocks.insertNodes,
  }
})

vi.mock('../plugins/custom-text/node', () => ({
  $createCustomTextNode: (text: string) => mocks.createTextNode(text),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'promptEditor.placeholderSandboxPrefix': 'Write instructions here, ',
        'promptEditor.placeholderSandboxInsert': 'insert',
        'promptEditor.placeholderSandboxSeparator': ', ',
        'promptEditor.placeholderSandboxTools': 'tools',
      }
      return translations[key] ?? key
    },
  }),
}))

describe('SandboxPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering states for sandbox support and tool visibility.
  describe('Rendering', () => {
    it('should render nothing when sandbox is not supported', () => {
      const { container } = render(<SandboxPlaceholder isSupportSandbox={false} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should render only the insert action when tool blocks are disabled', () => {
      render(
        <SandboxPlaceholder
          disableToolBlocks
          isSupportSandbox
        />,
      )

      expect(screen.getByText('Write instructions here,')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /insert/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /tools/i })).not.toBeInTheDocument()
    })

    it('should render insert and tools actions when tool blocks are enabled', () => {
      render(<SandboxPlaceholder isSupportSandbox />)

      expect(screen.getByRole('button', { name: /insert/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /tools/i })).toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(2)
    })
  })

  // Click interactions should reuse the editor trigger workflow.
  describe('Interactions', () => {
    it('should insert slash and clear the hide timeout when clicking insert', () => {
      render(<SandboxPlaceholder isSupportSandbox />)

      fireEvent.click(screen.getByRole('button', { name: /insert/i }))

      expect(mocks.editor.focus).toHaveBeenCalledTimes(1)
      expect(mocks.editor.update).toHaveBeenCalledTimes(1)
      expect(mocks.selectEnd).toHaveBeenCalledTimes(1)
      expect(mocks.createTextNode).toHaveBeenCalledWith('/')
      expect(mocks.insertNodes).toHaveBeenCalledWith([{ text: '/' }])
      expect(mocks.editor.dispatchCommand).toHaveBeenCalledWith(CLEAR_HIDE_MENU_TIMEOUT, undefined)
    })

    it('should insert at-sign and clear the hide timeout when clicking tools', () => {
      render(<SandboxPlaceholder isSupportSandbox />)

      fireEvent.click(screen.getByRole('button', { name: /tools/i }))

      expect(mocks.editor.focus).toHaveBeenCalledTimes(1)
      expect(mocks.editor.update).toHaveBeenCalledTimes(1)
      expect(mocks.selectEnd).toHaveBeenCalledTimes(1)
      expect(mocks.createTextNode).toHaveBeenCalledWith('@')
      expect(mocks.insertNodes).toHaveBeenCalledWith([{ text: '@' }])
      expect(mocks.editor.dispatchCommand).toHaveBeenCalledWith(CLEAR_HIDE_MENU_TIMEOUT, undefined)
    })

    it('should not trigger editor insertion when placeholder is not editable', () => {
      render(<SandboxPlaceholder isSupportSandbox editable={false} />)

      fireEvent.click(screen.getByRole('button', { name: /insert/i }))

      expect(mocks.editor.focus).not.toHaveBeenCalled()
      expect(mocks.editor.update).not.toHaveBeenCalled()
      expect(mocks.insertNodes).not.toHaveBeenCalled()
      expect(mocks.editor.dispatchCommand).not.toHaveBeenCalled()
    })
  })
})
