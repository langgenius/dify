import { render, screen, waitFor } from '@testing-library/react'
import { Markdown } from './index'

describe('Markdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing with basic content', async () => {
      // Arrange
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()
      const content = 'Hello World'

      // Act
      render(
        <QueryClientProvider client={queryClient}>
          <Markdown content={content} />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Hello World')).toBeInTheDocument()
      }, { timeout: 10000 })
    }, 20000)

    it('should apply default markdown-body className', () => {
      // Arrange & Act
      const { container } = render(<Markdown content="Test" />)

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toBeInTheDocument()
      expect(markdownDiv).toHaveClass('!text-text-primary')
    })

    it('should merge custom className with default classes', () => {
      // Arrange
      const className = 'custom-class another-class'

      // Act
      const { container } = render(
        <Markdown content="Test" className={className} />,
      )

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toHaveClass('markdown-body', '!text-text-primary', 'custom-class', 'another-class')
    })

    it('should handle undefined className', () => {
      // Arrange & Act
      const { container } = render(
        <Markdown content="Test" className={undefined} />,
      )

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toHaveClass('markdown-body', '!text-text-primary')
      expect(markdownDiv?.className).not.toContain('undefined')
    })
  })

  describe('Content Preprocessing - Think Tags', () => {
    it('should preprocess single think tag in content', async () => {
      // Arrange
      const content = '<think>Test thinking content</think>'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Test thinking content/i)).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should preprocess multiple think tags', async () => {
      // Arrange
      const content = '<think>First thought</think>\nSome text\n<think>Second thought</think>'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/First thought/i)).toBeInTheDocument()
        expect(screen.getByText(/Second thought/i)).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should handle think tags with whitespace', async () => {
      // Arrange
      const content = '<think>  \n  Content with spaces  \n  </think>'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Content with spaces/i)).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should handle consecutive think tags', async () => {
      // Arrange
      const content = '<think>First</think><think>Second</think>'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/First/i)).toBeInTheDocument()
        expect(screen.getByText(/Second/i)).toBeInTheDocument()
      }, { timeout: 5000 })
    })
  })

  describe('Content Preprocessing - LaTeX', () => {
    it('should preprocess LaTeX block notation', async () => {
      // Arrange
      const content = '\\[x^2 + y^2 = z^2\\]'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('x^2 + y^2 = z^2')
      }, { timeout: 5000 })
    })

    it('should preprocess LaTeX inline math with single dollars', async () => {
      // Arrange
      const content = 'The formula is $E = mc^2$ here'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('E = mc^2')
      }, { timeout: 5000 })
    })

    it('should preprocess LaTeX with parentheses notation', async () => {
      // Arrange
      const content = 'Inline \\(a + b\\) equation'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('a + b')
      })
    })

    it('should preprocess LaTeX multiline block notation', async () => {
      // Arrange
      const content = '\\[\nx^2 + y^2\n= z^2\n\\]'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('x^2 + y^2')
        expect(container.textContent).toContain('z^2')
      })
    })

    it('should handle multiple LaTeX expressions', async () => {
      // Arrange
      const content = 'First $a + b$ and second $c + d$ equations'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('a + b')
        expect(container.textContent).toContain('c + d')
      })
    })

    it('should preserve LaTeX inside code blocks', async () => {
      // Arrange
      const content = '```\n$E = mc^2$\n```'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('$E = mc^2$')
      })
    })
  })

  describe('Combined Preprocessing', () => {
    it('should apply both think tag and LaTeX preprocessing', async () => {
      // Arrange
      const content = '<think>Equation: \\[x^2 + y^2\\]</think>'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('Equation')
        expect(container.textContent).toContain('x^2 + y^2')
      })
    })

    it('should preserve markdown formatting during preprocessing', async () => {
      // Arrange
      const content = '**Bold** <think>thought</think> *italic* $E = mc^2$'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Bold')).toBeInTheDocument()
        // Use a more specific selector to avoid multiple matches for "thought"
        const thinkContent = container.querySelector('[data-think="true"]')
        expect(thinkContent?.textContent).toContain('thought')
        expect(screen.getByText('italic')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should handle complex nested structures', async () => {
      // Arrange
      const content = '<think>Math: $a^2$ and \\[b^2\\]</think>\n\n**Bold** text'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Math:/i)).toBeInTheDocument()
        expect(screen.getByText('Bold')).toBeInTheDocument()
      })
    })
  })

  describe('Props - pluginInfo', () => {
    it('should pass pluginInfo to ReactMarkdownWrapper', async () => {
      // Arrange
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()
      const pluginInfo = {
        pluginUniqueIdentifier: 'test-plugin-unique',
        pluginId: 'plugin-123',
      }

      // Act
      render(
        <QueryClientProvider client={queryClient}>
          <Markdown content="Test content" pluginInfo={pluginInfo} />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Test content')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should work without pluginInfo', async () => {
      // Arrange & Act
      render(<Markdown content="No plugin" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('No plugin')).toBeInTheDocument()
      })
    })

    it('should handle pluginInfo with images', async () => {
      // Arrange
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()
      const content = '![alt text](https://example.com/image.png)'
      const pluginInfo = {
        pluginUniqueIdentifier: 'image-plugin',
        pluginId: 'img-001',
      }

      // Act
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <Markdown content={content} pluginInfo={pluginInfo} />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        const img = container.querySelector('img')
        expect(img).toBeInTheDocument()
        // ImageGallery currently does not pass alt text to the img tag
        expect(img).toHaveAttribute('src')
      }, { timeout: 5000 })
    })

    it('should handle pluginInfo with paragraphs', async () => {
      // Arrange
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()
      const content = 'Paragraph with plugin'
      const pluginInfo = {
        pluginUniqueIdentifier: 'para-plugin',
        pluginId: 'p-001',
      }

      // Act
      render(
        <QueryClientProvider client={queryClient}>
          <Markdown content={content} pluginInfo={pluginInfo} />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Paragraph with plugin')).toBeInTheDocument()
      }, { timeout: 5000 })
    })
  })

  describe('Props - customComponents', () => {
    it('should use custom component when provided', async () => {
      // Arrange
      const CustomHeading = ({ children }: { children: React.ReactNode }) => (
        <h1 data-testid="custom-heading">{children}</h1>
      )
      const customComponents = { h1: CustomHeading }

      // Act
      render(
        <Markdown
          content="# Custom Heading"
          customComponents={customComponents}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('custom-heading')).toBeInTheDocument()
        expect(screen.getByText('Custom Heading')).toBeInTheDocument()
      })
    })

    it('should handle multiple custom components', async () => {
      // Arrange
      const CustomH1 = ({ children }: { children: React.ReactNode }) => (
        <h1 data-testid="custom-h1">{children}</h1>
      )
      const CustomH2 = ({ children }: { children: React.ReactNode }) => (
        <h2 data-testid="custom-h2">{children}</h2>
      )
      const customComponents = {
        h1: CustomH1,
        h2: CustomH2,
      }

      // Act
      render(
        <Markdown
          content={'# Heading 1\n\n## Heading 2'}
          customComponents={customComponents}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('custom-h1')).toBeInTheDocument()
        expect(screen.getByTestId('custom-h2')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should work with empty customComponents object', async () => {
      // Arrange & Act
      render(<Markdown content="# Heading" customComponents={{}} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Heading')).toBeInTheDocument()
      })
    })

    it('should override default component rendering', async () => {
      // Arrange
      const CustomParagraph = () => <div data-testid="custom-para">Custom</div>
      const customComponents = { p: CustomParagraph }

      // Act
      render(
        <Markdown content="Paragraph" customComponents={customComponents} />,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('custom-para')).toBeInTheDocument()
        expect(screen.getByText('Custom')).toBeInTheDocument()
      })
    })
  })

  describe('Props - customDisallowedElements', () => {
    it('should disallow specified elements', async () => {
      // Arrange
      const customDisallowedElements = ['strong']
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()

      // Act
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <Markdown
            content="**Bold text**"
            customDisallowedElements={customDisallowedElements}
          />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        expect(container.querySelector('strong')).not.toBeInTheDocument()
        // Component doesn't unwrap disallowed elements, so the text inside is also removed
        expect(container.querySelector('.markdown-body')?.textContent).toBe('')
      }, { timeout: 5000 })
    })

    it('should disallow multiple elements', async () => {
      // Arrange
      const customDisallowedElements = ['strong', 'em']

      // Act
      const { container } = render(
        <Markdown
          content="**Bold** and *italic*"
          customDisallowedElements={customDisallowedElements}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(container.querySelector('strong')).not.toBeInTheDocument()
        expect(container.querySelector('em')).not.toBeInTheDocument()
      })
    })

    it('should work without customDisallowedElements', async () => {
      // Arrange & Act
      render(<Markdown content="**Bold**" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Bold')).toBeInTheDocument()
      })
    })

    it('should combine with default disallowed elements', async () => {
      // Arrange
      const customDisallowedElements = ['blockquote']

      // Act
      const { container } = render(
        <Markdown
          content="> Quote"
          customDisallowedElements={customDisallowedElements}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(container.querySelector('blockquote')).not.toBeInTheDocument()
        // iframe, head, html, meta, link, style, body are already disallowed by default
        expect(container.querySelector('iframe')).not.toBeInTheDocument()
      })
    })
  })

  describe('Props - rehypePlugins', () => {
    it('should work with custom rehype plugins', async () => {
      // Arrange
      const mockPlugin = vi.fn(() => (tree: unknown) => tree)

      // Act
      render(<Markdown content="Test" rehypePlugins={[mockPlugin]} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })
    })

    it('should work without rehypePlugins', async () => {
      // Arrange & Act
      render(<Markdown content="Content" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Content')).toBeInTheDocument()
      })
    })

    it('should work with multiple rehype plugins', async () => {
      // Arrange
      const plugin1 = () => (tree: unknown) => tree
      const plugin2 = () => (tree: unknown) => tree
      const rehypePlugins = [plugin1, plugin2]

      // Act
      render(<Markdown content="Multi plugin" rehypePlugins={rehypePlugins} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Multi plugin')).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases - Content Variations', () => {
    it('should handle empty string content', async () => {
      // Arrange & Act
      const { container } = render(<Markdown content="" />)

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toBeInTheDocument()
    })

    it('should handle whitespace-only content', async () => {
      // Arrange & Act
      const { container } = render(<Markdown content="   \n  \t  " />)

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toBeInTheDocument()
    })

    it('should handle very long content', async () => {
      // Arrange
      const content = 'a'.repeat(10000)

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent?.length).toBeGreaterThanOrEqual(10000)
      })
    })

    it('should handle content with special characters', async () => {
      // Arrange
      const content = '`code` **bold** *italic* [link](url)'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('code')).toBeInTheDocument()
        expect(screen.getByText('bold')).toBeInTheDocument()
        expect(screen.getByText('italic')).toBeInTheDocument()
      })
    })

    it('should handle content with HTML entities', async () => {
      // Arrange
      const content = 'Test &amp; Content &lt;tag&gt;'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('Test')
      })
    })

    it('should handle content with only markdown special characters', async () => {
      // Arrange
      const content = '***---___'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      const markdownDiv = container.querySelector('.markdown-body')
      expect(markdownDiv).toBeInTheDocument()
    })

    it('should handle content with unicode characters', async () => {
      // Arrange
      const content = 'Hello 世界 🌍 émoji'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Hello 世界 🌍 émoji/)).toBeInTheDocument()
      })
    })

    it('should handle content with newlines', async () => {
      // Arrange
      const content = 'Line 1\nLine 2\n\nLine 3'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Line 1/)).toBeInTheDocument()
        expect(screen.getByText(/Line 2/)).toBeInTheDocument()
        expect(screen.getByText(/Line 3/)).toBeInTheDocument()
      })
    })
  })

  describe('Markdown Features Integration', () => {
    it('should render headings', async () => {
      // Arrange
      const content = '# H1\n## H2\n### H3'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'H1' })).toBeInTheDocument()
        expect(screen.getByRole('heading', { level: 2, name: 'H2' })).toBeInTheDocument()
        expect(screen.getByRole('heading', { level: 3, name: 'H3' })).toBeInTheDocument()
      })
    })

    it('should render lists', async () => {
      // Arrange
      const content = '- Item 1\n- Item 2\n- Item 3'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Item 1')).toBeInTheDocument()
        expect(screen.getByText('Item 2')).toBeInTheDocument()
        expect(screen.getByText('Item 3')).toBeInTheDocument()
      })
    })

    it('should render ordered lists', async () => {
      // Arrange
      const content = '1. First\n2. Second\n3. Third'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument()
        expect(screen.getByText('Second')).toBeInTheDocument()
        expect(screen.getByText('Third')).toBeInTheDocument()
      })
    })

    it('should render blockquotes', async () => {
      // Arrange
      const content = '> This is a quote\n> with multiple lines'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/This is a quote/)).toBeInTheDocument()
        expect(screen.getByText(/with multiple lines/)).toBeInTheDocument()
      })
    })

    it('should render code blocks', async () => {
      // Arrange
      const content = '```javascript\nconst x = 1;\nconsole.log(x);\n```'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.textContent).toContain('const x = 1')
        expect(container.textContent).toContain('console.log(x)')
      }, { timeout: 5000 })
    })

    it('should render inline code', async () => {
      // Arrange
      const content = 'Use `const` for variables'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('const')).toBeInTheDocument()
        expect(screen.getByText(/Use.*for variables/)).toBeInTheDocument()
      })
    })

    it('should render links', async () => {
      // Arrange
      const content = '[Click here](https://example.com)'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'Click here' })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', 'https://example.com')
      })
    })

    it('should render images without pluginInfo', async () => {
      // Arrange
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
      const queryClient = new QueryClient()
      const content = '![alt text](https://example.com/image.png)'

      // Act
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <Markdown content={content} />
        </QueryClientProvider>,
      )

      // Assert
      await waitFor(() => {
        const img = container.querySelector('img')
        expect(img).toBeInTheDocument()
        // ImageGallery currently does not pass alt text to the img tag
        expect(img).toHaveAttribute('src', 'https://example.com/image.png')
      }, { timeout: 5000 })
    })

    it('should render tables', async () => {
      // Arrange
      const content = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Header 1')).toBeInTheDocument()
        expect(screen.getByText('Header 2')).toBeInTheDocument()
        expect(screen.getByText('Cell 1')).toBeInTheDocument()
        expect(screen.getByText('Cell 2')).toBeInTheDocument()
      })
    })

    it('should render horizontal rules', async () => {
      // Arrange
      const content = 'Above\n\n---\n\nBelow'

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(container.querySelector('hr')).toBeInTheDocument()
        expect(screen.getByText('Above')).toBeInTheDocument()
        expect(screen.getByText('Below')).toBeInTheDocument()
      })
    })
  })

  describe('Complex Markdown Structures', () => {
    it('should handle nested lists', async () => {
      // Arrange
      const content = '- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Item 1')).toBeInTheDocument()
        expect(screen.getByText('Nested 1')).toBeInTheDocument()
        expect(screen.getByText('Nested 2')).toBeInTheDocument()
        expect(screen.getByText('Item 2')).toBeInTheDocument()
      })
    })

    it('should handle blockquote with formatting', async () => {
      // Arrange
      const content = '> Blockquote with **bold** and *italic*'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Blockquote with/)).toBeInTheDocument()
        expect(screen.getByText('bold')).toBeInTheDocument()
        expect(screen.getByText('italic')).toBeInTheDocument()
      })
    })

    it('should handle mixed content types', async () => {
      // Arrange
      const content = `
# Heading

Regular paragraph with **bold**.

- List item 1
- List item 2

\`\`\`javascript
const code = "test";
\`\`\`

> Quote text

[Link](https://example.com)
      `

      // Act
      const { container } = render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
        expect(screen.getByText(/Regular paragraph/)).toBeInTheDocument()
        expect(screen.getByText('bold')).toBeInTheDocument()
        expect(screen.getByText('List item 1')).toBeInTheDocument()
        expect(container.textContent).toContain('const code')
        expect(screen.getByText(/Quote text/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Link' })).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('should handle strikethrough', async () => {
      // Arrange
      const content = '~~strikethrough text~~'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('strikethrough text')).toBeInTheDocument()
      })
    })

    it('should handle task lists', async () => {
      // Arrange
      const content = '- [x] Completed task\n- [ ] Incomplete task'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Completed task/)).toBeInTheDocument()
        expect(screen.getByText(/Incomplete task/)).toBeInTheDocument()
      })
    })
  })

  describe('All Props Combined', () => {
    it('should handle all props together', async () => {
      // Arrange
      const CustomH1 = ({ children }: { children: React.ReactNode }) => (
        <h1 data-testid="custom-h1">{children}</h1>
      )
      const pluginInfo = {
        pluginUniqueIdentifier: 'test-plugin',
        pluginId: 'plugin-123',
      }
      const customComponents = { h1: CustomH1 }
      const customDisallowedElements = ['em']
      const mockPlugin = () => (tree: unknown) => tree
      const rehypePlugins = [mockPlugin]

      // Act
      render(
        <Markdown
          content="# Heading with *italic*"
          className="custom-class"
          pluginInfo={pluginInfo}
          customComponents={customComponents}
          customDisallowedElements={customDisallowedElements}
          rehypePlugins={rehypePlugins}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('custom-h1')).toBeInTheDocument()
        expect(screen.getByText('Heading with')).toBeInTheDocument()
        const container = screen.getByTestId('custom-h1').closest('.markdown-body')
        expect(container).toHaveClass('custom-class')
      })
    })

    it('should work with minimal props', async () => {
      // Arrange & Act
      render(<Markdown content="Minimal" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Minimal')).toBeInTheDocument()
      })
    })
  })

  describe('Content Type Edge Cases', () => {
    it('should handle content with only numbers', async () => {
      // Arrange
      const content = '123456789'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('123456789')).toBeInTheDocument()
      })
    })

    it('should handle content with URLs', async () => {
      // Arrange
      const content = 'Visit https://example.com for more info'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Visit/)).toBeInTheDocument()
        expect(screen.getByText(/example\.com/)).toBeInTheDocument()
      })
    })

    it('should handle content with email addresses', async () => {
      // Arrange
      const content = 'Contact: test@example.com'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Contact:/)).toBeInTheDocument()
        expect(screen.getByText(/test@example\.com/)).toBeInTheDocument()
      })
    })

    it('should handle content with escape sequences', async () => {
      // Arrange
      const content = 'Use \\* for literal asterisks'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Use.*for literal asterisks/)).toBeInTheDocument()
      })
    })

    it('should handle content with backslashes', async () => {
      // Arrange
      const content = 'Path: C:\\\\Users\\\\folder'

      // Act
      render(<Markdown content={content} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Path:/)).toBeInTheDocument()
      })
    })
  })
})
