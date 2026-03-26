import { render } from '@testing-library/react'
import SandboxPlaceholder from '../sandbox-placeholder'

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

  // Rendering branches for sandbox availability and tool-block support.
  describe('Rendering', () => {
    it('should render nothing when sandbox is not supported', () => {
      const { container } = render(<SandboxPlaceholder isSupportSandbox={false} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should render only the insert pair when tool blocks are disabled', () => {
      const { container } = render(
        <SandboxPlaceholder
          disableToolBlocks
          isSupportSandbox
        />,
      )

      expect(container).toHaveTextContent('Write instructions here, /insert')
      const tokens = container.querySelectorAll('.group\\/placeholder-token')
      const kbdTokens = container.querySelectorAll('.system-kbd')
      const actionTokens = container.querySelectorAll('.border-dotted')

      expect(tokens).toHaveLength(1)
      expect(kbdTokens).toHaveLength(1)
      expect(actionTokens).toHaveLength(1)
      expect(tokens[0]).toHaveClass(
        'inline-flex',
        'cursor-pointer',
        'items-center',
        'gap-1',
        'text-text-tertiary',
        'hover:text-components-button-secondary-accent-text',
      )
      expect(kbdTokens[0]).toHaveClass(
        'bg-components-kbd-bg-gray',
        'group-hover/placeholder-token:bg-components-button-secondary-accent-text-disabled',
      )
      expect(kbdTokens[0]).toHaveTextContent('/')
      expect(actionTokens[0]).toHaveClass(
        'pointer-events-auto',
        'border-b',
        'border-dotted',
        'border-current',
      )
      expect(actionTokens[0]).toHaveTextContent('insert')
    })

    it('should render both insert and tools pairs when tool blocks are enabled', () => {
      const { container } = render(<SandboxPlaceholder isSupportSandbox />)

      expect(container).toHaveTextContent('Write instructions here, /insert, @tools')
      const tokens = container.querySelectorAll('.group\\/placeholder-token')
      const kbdTokens = container.querySelectorAll('.system-kbd')
      const actionTokens = container.querySelectorAll('.border-dotted')

      expect(tokens).toHaveLength(2)
      expect(kbdTokens).toHaveLength(2)
      expect(actionTokens).toHaveLength(2)
      expect(kbdTokens[0]).toHaveTextContent('/')
      expect(kbdTokens[1]).toHaveTextContent('@')
      expect(actionTokens[0]).toHaveTextContent('insert')
      expect(actionTokens[1]).toHaveTextContent('tools')
      expect(tokens[1]).toHaveClass(
        'group/placeholder-token',
        'hover:text-components-button-secondary-accent-text',
      )
    })
  })
})
