import type { PropsWithChildren } from 'react'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import StreamdownWrapper from '../streamdown-wrapper'

const TILDE_RANGE_RE = /0\.3~8mm/

vi.mock('@/app/components/base/markdown-blocks/code-block', () => ({
  CodeBlock: ({ children }: PropsWithChildren) => <code>{children}</code>,
}))

describe('StreamdownWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Strikethrough rendering', () => {
    it('should handle mixed content with single and double tildes correctly', () => {
      // Arrange - real-world example from issue #31391
      const content = 'PCB thickness: 0.3~8mm and ~~removed feature~~ text'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      // Only double tildes should create strikethrough
      const delElements = document.querySelectorAll('del')
      expect(delElements).toHaveLength(1)
      expect(delElements[0]!.textContent).toBe('removed feature')

      // Single tilde should remain as literal text
      // Single tilde should remain as literal text
      expect(screen.getByText(TILDE_RANGE_RE))!.toBeInTheDocument()
    })
  })

  describe('Basic rendering', () => {
    it('should render standard Image component when pluginInfo is not provided', () => {
      // Act
      render(<StreamdownWrapper latexContent="![standard-img](https://example.com/img.png)" />)

      // Assert
      // Assert
      expect(screen.getByTestId('gallery-image')).toHaveAttribute(
        'src',
        'https://example.com/img.png',
      )
    })

    it('should render a CodeBlock component for code markdown', async () => {
      // Arrange
      const content = '```javascript\nconsole.log("hello")\n```'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      // We mocked code block to return <code>{children}</code>
      const codeElement = await screen.findByText('console.log("hello")')
      expect(codeElement)!.toBeInTheDocument()
    })
  })

  describe('Plugin Info behavior', () => {
    it('should render PluginImg and PluginParagraph when pluginInfo is provided', () => {
      // Arrange
      const content = 'This is a plugin paragraph\n\n![plugin-img](_assets/plugin.png)'
      const pluginInfo = { pluginUniqueIdentifier: '', pluginId: 'plugin-1' }

      // Act
      render(<StreamdownWrapper latexContent={content} pluginInfo={pluginInfo} />)

      // Assert
      // Assert
      expect(screen.getByText('This is a plugin paragraph')).toBeInTheDocument()
      expect(screen.getByTestId('gallery-image')).toHaveAttribute(
        'src',
        expect.stringContaining('/plugins/plugin-1/_assets/plugin.png'),
      )
    })
  })

  describe('Custom elements configuration', () => {
    it('should use customComponents if provided', () => {
      // Arrange
      const customComponents = {
        a: ({ children }: PropsWithChildren) => <a href="https://custom.example">{children}</a>,
      }

      // Act
      render(
        <StreamdownWrapper
          latexContent="[link](https://example.com)"
          customComponents={customComponents}
        />,
      )

      // Assert
      // Assert
      expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute(
        'href',
        'https://custom.example',
      )
    })

    it('should disallow customDisallowedElements', () => {
      // Act - disallow strong (which is usually **bold**)
      render(<StreamdownWrapper latexContent="**bold**" customDisallowedElements={['strong']} />)

      // Assert - strong element shouldn't be rendered (it will be stripped out)
      expect(document.querySelector('[data-streamdown="strong"]')).toBeNull()
    })
  })

  describe('Rehype AST modification', () => {
    it('should remove ref attributes from elements', () => {
      // Act
      render(<StreamdownWrapper latexContent={'<div ref="someRef">content</div>'} />)

      // Assert - ref attribute should be removed
      // Assert - ref attribute should be removed
      expect(screen.getByText('content'))!.toBeInTheDocument()
      expect(document.querySelector('[ref="someRef"]')).toBeNull()
    })

    it('should strip disallowed tags but preserve their text content', () => {
      // Act - <custom-element> is not in the allowed tag list
      render(<StreamdownWrapper latexContent="<custom-element>content</custom-element>" />)

      // Assert - rehype-sanitize strips the tag but keeps inner text
      // Assert - rehype-sanitize strips the tag but keeps inner text
      expect(screen.getByText('content'))!.toBeInTheDocument()
      expect(document.querySelector('custom-element')).toBeNull()
    })
  })
})
