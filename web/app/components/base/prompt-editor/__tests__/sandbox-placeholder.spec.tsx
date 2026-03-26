import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import SandboxPlaceholder from '../sandbox-placeholder'

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey, components = [] }: {
    i18nKey: string
    components?: ReactElement[]
  }) => (
    <div data-i18n-key={i18nKey} data-testid="sandbox-placeholder-trans">
      {components}
    </div>
  ),
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
      expect(screen.queryByTestId('sandbox-placeholder-trans')).not.toBeInTheDocument()
    })

    it('should render slash and insert tokens when tool blocks are disabled', () => {
      const { container } = render(
        <SandboxPlaceholder
          disableToolBlocks
          isSupportSandbox
        />,
      )

      expect(screen.getByTestId('sandbox-placeholder-trans')).toHaveAttribute('data-i18n-key', 'promptEditor.placeholderSandboxNoTools')

      const spans = container.querySelectorAll('span')
      expect(spans).toHaveLength(2)
      expect(spans[0]).toHaveClass('inline-flex', 'bg-components-kbd-bg-gray', 'system-kbd')
      expect(spans[1]).toHaveClass('border-b', 'border-dotted', 'border-current')
    })

    it('should render slash insert at and tools tokens when tool blocks are enabled', () => {
      const { container } = render(<SandboxPlaceholder isSupportSandbox />)

      expect(screen.getByTestId('sandbox-placeholder-trans')).toHaveAttribute('data-i18n-key', 'promptEditor.placeholderSandbox')

      const spans = container.querySelectorAll('span')
      expect(spans).toHaveLength(4)
      expect(spans[0]).toHaveClass('inline-flex', 'bg-components-kbd-bg-gray', 'system-kbd')
      expect(spans[1]).toHaveClass('border-b', 'border-dotted', 'border-current')
      expect(spans[2]).toHaveClass('inline-flex', 'bg-components-kbd-bg-gray', 'system-kbd')
      expect(spans[3]).toHaveClass('border-b', 'border-dotted', 'border-current')
    })
  })
})
