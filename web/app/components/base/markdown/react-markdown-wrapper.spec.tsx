import type { PropsWithChildren, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { ReactMarkdownWrapper } from './react-markdown-wrapper'

vi.mock('@/app/components/base/markdown-blocks', () => ({
  AudioBlock: ({ children }: PropsWithChildren) => <div data-testid="audio-block">{children}</div>,
  Img: ({ alt }: { alt?: string }) => <span data-testid="img">{alt}</span>,
  Link: ({ children, href }: { children?: ReactNode, href?: string }) => <a href={href}>{children}</a>,
  MarkdownButton: ({ children }: PropsWithChildren) => <button>{children}</button>,
  MarkdownForm: ({ children }: PropsWithChildren) => <form>{children}</form>,
  Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p>,
  PluginImg: ({ alt }: { alt?: string }) => <span data-testid="plugin-img">{alt}</span>,
  PluginParagraph: ({ children }: PropsWithChildren) => <p>{children}</p>,
  ScriptBlock: () => null,
  ThinkBlock: ({ children }: PropsWithChildren) => <details>{children}</details>,
  VideoBlock: ({ children }: PropsWithChildren) => <div data-testid="video-block">{children}</div>,
}))

vi.mock('@/app/components/base/markdown-blocks/code-block', () => ({
  default: ({ children }: PropsWithChildren) => <code>{children}</code>,
}))

describe('ReactMarkdownWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Strikethrough rendering', () => {
    it('should NOT render single tilde as strikethrough', () => {
      // Arrange - single tilde should be rendered as literal text
      const content = 'Range: 0.3~8mm'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert - check that ~ is rendered as text, not as strikethrough (del element)
      // The content should contain the tilde as literal text
      expect(screen.getByText(/0\.3~8mm/)).toBeInTheDocument()
      expect(document.querySelector('del')).toBeNull()
    })

    it('should render double tildes as strikethrough', () => {
      // Arrange - double tildes should create strikethrough
      const content = 'This is ~~strikethrough~~ text'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert - del element should be present for double tildes
      const delElement = document.querySelector('del')
      expect(delElement).not.toBeNull()
      expect(delElement?.textContent).toBe('strikethrough')
    })

    it('should handle mixed content with single and double tildes correctly', () => {
      // Arrange - real-world example from issue #31391
      const content = 'PCB thickness: 0.3~8mm and ~~removed feature~~ text'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert
      // Only double tildes should create strikethrough
      const delElements = document.querySelectorAll('del')
      expect(delElements).toHaveLength(1)
      expect(delElements[0].textContent).toBe('removed feature')

      // Single tilde should remain as literal text
      expect(screen.getByText(/0\.3~8mm/)).toBeInTheDocument()
    })
  })

  describe('Basic rendering', () => {
    it('should render plain text content', () => {
      // Arrange
      const content = 'Hello World'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })

    it('should render bold text', () => {
      // Arrange
      const content = '**bold text**'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('bold text')).toBeInTheDocument()
      expect(document.querySelector('strong')).not.toBeNull()
    })

    it('should render italic text', () => {
      // Arrange
      const content = '*italic text*'

      // Act
      render(<ReactMarkdownWrapper latexContent={content} />)

      // Assert
      expect(screen.getByText('italic text')).toBeInTheDocument()
      expect(document.querySelector('em')).not.toBeNull()
    })
  })
})
