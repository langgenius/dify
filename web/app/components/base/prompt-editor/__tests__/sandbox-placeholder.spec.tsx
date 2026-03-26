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
      expect(container.querySelector('.sandbox-placeholder-pair-insert')).toBeInTheDocument()
      expect(container.querySelector('.sandbox-placeholder-pair-tools')).not.toBeInTheDocument()
      expect(container.querySelector('.sandbox-placeholder-action-insert')).toHaveClass(
        'pointer-events-auto',
        'border-dotted',
      )
    })

    it('should render both insert and tools pairs with linked hover classes when tool blocks are enabled', () => {
      const { container } = render(<SandboxPlaceholder isSupportSandbox />)

      expect(container).toHaveTextContent('Write instructions here, /insert, @tools')
      expect(container.querySelector('.sandbox-placeholder-kbd-insert')).toHaveTextContent('/')
      expect(container.querySelector('.sandbox-placeholder-kbd-tools')).toHaveTextContent('@')
      expect(container.querySelector('.sandbox-placeholder-action-insert')).toHaveTextContent('insert')
      expect(container.querySelector('.sandbox-placeholder-action-tools')).toHaveTextContent('tools')
      expect(container.querySelector('.sandbox-placeholder-pair-insert')).toHaveClass(
        'has-[.sandbox-placeholder-action-insert:hover]:[&_.sandbox-placeholder-kbd-insert]:bg-state-accent-hover-alt',
        'has-[.sandbox-placeholder-action-insert:hover]:[&_.sandbox-placeholder-action-insert]:bg-state-accent-hover',
        'has-[.sandbox-placeholder-action-insert:hover]:[&_.sandbox-placeholder-action-insert]:text-text-accent-secondary',
      )
      expect(container.querySelector('.sandbox-placeholder-pair-tools')).toHaveClass(
        'has-[.sandbox-placeholder-action-tools:hover]:[&_.sandbox-placeholder-kbd-tools]:bg-state-accent-hover-alt',
        'has-[.sandbox-placeholder-action-tools:hover]:[&_.sandbox-placeholder-action-tools]:bg-state-accent-hover',
        'has-[.sandbox-placeholder-action-tools:hover]:[&_.sandbox-placeholder-action-tools]:text-text-accent-secondary',
      )
    })
  })
})
