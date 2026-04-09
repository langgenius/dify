import type { PropsWithChildren, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import StreamdownWrapper from '../streamdown-wrapper'

const TILDE_RANGE_RE = /0\.3~8mm/

vi.mock('@/app/components/base/markdown-blocks', () => ({
  AudioBlock: ({ children }: PropsWithChildren) => <div data-testid="audio-block">{children}</div>,
  Img: ({ alt }: { alt?: string }) => <span data-testid="img">{alt}</span>,
  Link: ({ children, href }: { children?: ReactNode, href?: string }) => <a href={href}>{children}</a>,
  MarkdownButton: ({ children }: PropsWithChildren) => <button>{children}</button>,
  MarkdownForm: ({ children }: PropsWithChildren) => <form>{children}</form>,
  Paragraph: ({ children }: PropsWithChildren) => <p data-testid="paragraph">{children}</p>,
  PluginImg: ({ alt }: { alt?: string }) => <span data-testid="plugin-img">{alt}</span>,
  PluginParagraph: ({ children }: PropsWithChildren) => <p data-testid="plugin-paragraph">{children}</p>,
  ScriptBlock: () => null,
  ThinkBlock: ({ children }: PropsWithChildren) => <details>{children}</details>,
  VideoBlock: ({ children }: PropsWithChildren) => <div data-testid="video-block">{children}</div>,
}))

vi.mock('@/app/components/base/markdown-blocks/code-block', () => ({
  default: ({ children }: PropsWithChildren) => <code>{children}</code>,
}))

describe('StreamdownWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Strikethrough rendering', () => {
    it('should NOT render single tilde as strikethrough', () => {
      // Arrange - single tilde should be rendered as literal text
      const content = 'Range: 0.3~8mm'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert - check that ~ is rendered as text, not as strikethrough (del element)
      // The content should contain the tilde as literal text
      expect(screen.getByText(TILDE_RANGE_RE)).toBeInTheDocument()
      expect(document.querySelector('del')).toBeNull()
    })

    it('should render double tildes as strikethrough', () => {
      // Arrange - double tildes should create strikethrough
      const content = 'This is ~~strikethrough~~ text'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert - del element should be present for double tildes
      const delElement = document.querySelector('del')
      expect(delElement).not.toBeNull()
      expect(delElement?.textContent).toBe('strikethrough')
    })

    it('should handle mixed content with single and double tildes correctly', () => {
      // Arrange - real-world example from issue #31391
      const content = 'PCB thickness: 0.3~8mm and ~~removed feature~~ text'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      // Only double tildes should create strikethrough
      const delElements = document.querySelectorAll('del')
      expect(delElements).toHaveLength(1)
      expect(delElements[0].textContent).toBe('removed feature')

      // Single tilde should remain as literal text
      expect(screen.getByText(TILDE_RANGE_RE)).toBeInTheDocument()
    })
  })

  describe('Basic rendering', () => {
    it('should render plain text content', () => {
      // Arrange
      const content = 'Hello World'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })

    it('should render bold text', () => {
      // Arrange
      const content = '**bold text**'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('bold text')).toBeInTheDocument()
      expect(document.querySelector('[data-streamdown="strong"]')).not.toBeNull()
    })

    it('should render italic text', () => {
      // Arrange
      const content = '*italic text*'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('italic text')).toBeInTheDocument()
      expect(document.querySelector('em')).not.toBeNull()
    })

    it('should render standard Image component when pluginInfo is not provided', () => {
      // Act
      render(<StreamdownWrapper latexContent="![standard-img](https://example.com/img.png)" />)

      // Assert
      expect(screen.getByTestId('img')).toBeInTheDocument()
    })

    it('should render a CodeBlock component for code markdown', async () => {
      // Arrange
      const content = '```javascript\nconsole.log("hello")\n```'

      // Act
      render(<StreamdownWrapper latexContent={content} />)

      // Assert
      // We mocked code block to return <code>{children}</code>
      const codeElement = await screen.findByText('console.log("hello")')
      expect(codeElement).toBeInTheDocument()
    })
  })

  describe('Plugin Info behavior', () => {
    it('should render PluginImg and PluginParagraph when pluginInfo is provided', () => {
      // Arrange
      const content = 'This is a plugin paragraph\n\n![plugin-img](https://example.com/plugin.png)'
      const pluginInfo = { pluginUniqueIdentifier: 'test-plugin', pluginId: 'plugin-1' }

      // Act
      render(<StreamdownWrapper latexContent={content} pluginInfo={pluginInfo} />)

      // Assert
      expect(screen.getByTestId('plugin-img')).toBeInTheDocument()
      expect(screen.queryByTestId('img')).toBeNull()

      expect(screen.getAllByTestId('plugin-paragraph').length).toBeGreaterThan(0)
      expect(screen.queryByTestId('paragraph')).toBeNull()
    })
  })

  describe('Custom elements configuration', () => {
    it('should use customComponents if provided', () => {
      // Arrange
      const customComponents = {
        a: ({ children }: PropsWithChildren) => <a data-testid="custom-link">{children}</a>,
      }

      // Act
      render(<StreamdownWrapper latexContent="[link](https://example.com)" customComponents={customComponents} />)

      // Assert
      expect(screen.getByTestId('custom-link')).toBeInTheDocument()
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
      expect(screen.getByText('content')).toBeInTheDocument()
      expect(document.querySelector('[ref="someRef"]')).toBeNull()
    })

    it('should strip disallowed tags but preserve their text content', () => {
      // Act - <custom-element> is not in the allowed tag list
      render(<StreamdownWrapper latexContent="<custom-element>content</custom-element>" />)

      // Assert - rehype-sanitize strips the tag but keeps inner text
      expect(screen.getByText('content')).toBeInTheDocument()
      expect(document.querySelector('custom-element')).toBeNull()
    })
  })
})
