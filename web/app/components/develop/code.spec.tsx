import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Code, CodeGroup, Embed, Pre } from './code'

// Mock the clipboard utility
vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
}))

describe('code.tsx components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('Code', () => {
    it('should render children', () => {
      render(<Code>const x = 1</Code>)
      expect(screen.getByText('const x = 1')).toBeInTheDocument()
    })

    it('should render as code element', () => {
      render(<Code>code snippet</Code>)
      const codeElement = screen.getByText('code snippet')
      expect(codeElement.tagName).toBe('CODE')
    })

    it('should pass through additional props', () => {
      render(<Code data-testid="custom-code" className="custom-class">snippet</Code>)
      const codeElement = screen.getByTestId('custom-code')
      expect(codeElement).toHaveClass('custom-class')
    })

    it('should render with complex children', () => {
      render(
        <Code>
          <span>part1</span>
          <span>part2</span>
        </Code>,
      )
      expect(screen.getByText('part1')).toBeInTheDocument()
      expect(screen.getByText('part2')).toBeInTheDocument()
    })
  })

  describe('Embed', () => {
    it('should render value prop', () => {
      render(<Embed value="embedded content">ignored children</Embed>)
      expect(screen.getByText('embedded content')).toBeInTheDocument()
    })

    it('should render as span element', () => {
      render(<Embed value="test value">children</Embed>)
      const span = screen.getByText('test value')
      expect(span.tagName).toBe('SPAN')
    })

    it('should pass through additional props', () => {
      render(<Embed value="content" data-testid="embed-test" className="embed-class">children</Embed>)
      const embed = screen.getByTestId('embed-test')
      expect(embed).toHaveClass('embed-class')
    })

    it('should not render children, only value', () => {
      render(<Embed value="shown">hidden children</Embed>)
      expect(screen.getByText('shown')).toBeInTheDocument()
      expect(screen.queryByText('hidden children')).not.toBeInTheDocument()
    })
  })

  describe('CodeGroup', () => {
    describe('with string targetCode', () => {
      it('should render code from targetCode string', () => {
        render(
          <CodeGroup targetCode="const hello = 'world'">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('const hello = \'world\'')).toBeInTheDocument()
      })

      it('should have shadow and rounded styles', () => {
        const { container } = render(
          <CodeGroup targetCode="code here">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeGroup = container.querySelector('.shadow-md')
        expect(codeGroup).toBeInTheDocument()
        expect(codeGroup).toHaveClass('rounded-2xl')
      })

      it('should have bg-zinc-900 background', () => {
        const { container } = render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeGroup = container.querySelector('.bg-zinc-900')
        expect(codeGroup).toBeInTheDocument()
      })
    })

    describe('with array targetCode', () => {
      it('should render single code example without tabs', () => {
        const examples = [{ code: 'single example' }]
        render(
          <CodeGroup targetCode={examples}>
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('single example')).toBeInTheDocument()
      })

      it('should render multiple code examples with tabs', () => {
        const examples = [
          { title: 'JavaScript', code: 'console.log("js")' },
          { title: 'Python', code: 'print("py")' },
        ]
        render(
          <CodeGroup targetCode={examples}>
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByRole('tab', { name: 'JavaScript' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Python' })).toBeInTheDocument()
      })

      it('should show first tab content by default', () => {
        const examples = [
          { title: 'Tab1', code: 'first content' },
          { title: 'Tab2', code: 'second content' },
        ]
        render(
          <CodeGroup targetCode={examples}>
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('first content')).toBeInTheDocument()
      })

      it('should switch tabs on click', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const examples = [
          { title: 'Tab1', code: 'first content' },
          { title: 'Tab2', code: 'second content' },
        ]
        render(
          <CodeGroup targetCode={examples}>
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )

        const tab2 = screen.getByRole('tab', { name: 'Tab2' })
        await act(async () => {
          await user.click(tab2)
        })

        await waitFor(() => {
          expect(screen.getByText('second content')).toBeInTheDocument()
        })
      })

      it('should use "Code" as default title when title not provided', () => {
        const examples = [
          { code: 'example 1' },
          { code: 'example 2' },
        ]
        render(
          <CodeGroup targetCode={examples}>
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeTabs = screen.getAllByRole('tab', { name: 'Code' })
        expect(codeTabs).toHaveLength(2)
      })
    })

    describe('with title prop', () => {
      it('should render title in header', () => {
        render(
          <CodeGroup title="API Example" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('API Example')).toBeInTheDocument()
      })

      it('should render title in h3 element', () => {
        render(
          <CodeGroup title="Example Title" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const h3 = screen.getByRole('heading', { level: 3 })
        expect(h3).toHaveTextContent('Example Title')
      })
    })

    describe('with tag and label props', () => {
      it('should render tag in code panel header', () => {
        render(
          <CodeGroup tag="GET" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('GET')).toBeInTheDocument()
      })

      it('should render label in code panel header', () => {
        render(
          <CodeGroup label="/api/users" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('/api/users')).toBeInTheDocument()
      })

      it('should render both tag and label with separator', () => {
        const { container } = render(
          <CodeGroup tag="POST" label="/api/create" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('POST')).toBeInTheDocument()
        expect(screen.getByText('/api/create')).toBeInTheDocument()
        // Separator should be present
        const separator = container.querySelector('.rounded-full.bg-zinc-500')
        expect(separator).toBeInTheDocument()
      })
    })

    describe('CopyButton functionality', () => {
      it('should render copy button', () => {
        render(
          <CodeGroup targetCode="copyable code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const copyButton = screen.getByRole('button')
        expect(copyButton).toBeInTheDocument()
      })

      it('should show "Copy" text initially', () => {
        render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('Copy')).toBeInTheDocument()
      })

      it('should show "Copied!" after clicking copy button', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const { writeTextToClipboard } = await import('@/utils/clipboard')

        render(
          <CodeGroup targetCode="code to copy">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )

        const copyButton = screen.getByRole('button')
        await act(async () => {
          await user.click(copyButton)
        })

        await waitFor(() => {
          expect(writeTextToClipboard).toHaveBeenCalledWith('code to copy')
        })

        expect(screen.getByText('Copied!')).toBeInTheDocument()
      })

      it('should reset copy state after timeout', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

        render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )

        const copyButton = screen.getByRole('button')
        await act(async () => {
          await user.click(copyButton)
        })

        await waitFor(() => {
          expect(screen.getByText('Copied!')).toBeInTheDocument()
        })

        // Advance time past the timeout
        await act(async () => {
          vi.advanceTimersByTime(1500)
        })

        await waitFor(() => {
          expect(screen.getByText('Copy')).toBeInTheDocument()
        })
      })
    })

    describe('without targetCode (using children)', () => {
      it('should render children when no targetCode provided', () => {
        render(
          <CodeGroup>
            <pre><code>child code content</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('child code content')).toBeInTheDocument()
      })
    })

    describe('styling', () => {
      it('should have not-prose class to prevent prose styling', () => {
        const { container } = render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeGroup = container.querySelector('.not-prose')
        expect(codeGroup).toBeInTheDocument()
      })

      it('should have my-6 margin', () => {
        const { container } = render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeGroup = container.querySelector('.my-6')
        expect(codeGroup).toBeInTheDocument()
      })

      it('should have overflow-hidden', () => {
        const { container } = render(
          <CodeGroup targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const codeGroup = container.querySelector('.overflow-hidden')
        expect(codeGroup).toBeInTheDocument()
      })
    })
  })

  describe('Pre', () => {
    describe('when outside CodeGroup context', () => {
      it('should wrap children in CodeGroup', () => {
        const { container } = render(
          <Pre>
            <pre><code>code content</code></pre>
          </Pre>,
        )
        // Should render within a CodeGroup structure
        const codeGroup = container.querySelector('.bg-zinc-900')
        expect(codeGroup).toBeInTheDocument()
      })

      it('should pass props to CodeGroup', () => {
        render(
          <Pre title="Pre Title">
            <pre><code>code</code></pre>
          </Pre>,
        )
        expect(screen.getByText('Pre Title')).toBeInTheDocument()
      })
    })

    describe('when inside CodeGroup context (isGrouped)', () => {
      it('should return children directly without wrapping', () => {
        render(
          <CodeGroup targetCode="outer code">
            <Pre>
              <code>inner code</code>
            </Pre>
          </CodeGroup>,
        )
        // The outer code should be rendered (from targetCode)
        expect(screen.getByText('outer code')).toBeInTheDocument()
      })
    })
  })

  describe('CodePanelHeader (via CodeGroup)', () => {
    it('should not render when neither tag nor label provided', () => {
      const { container } = render(
        <CodeGroup targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const headerDivider = container.querySelector('.border-b-white\\/7\\.5')
      expect(headerDivider).not.toBeInTheDocument()
    })

    it('should render when only tag is provided', () => {
      render(
        <CodeGroup tag="GET" targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText('GET')).toBeInTheDocument()
    })

    it('should render when only label is provided', () => {
      render(
        <CodeGroup label="/api/endpoint" targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText('/api/endpoint')).toBeInTheDocument()
    })

    it('should render label with font-mono styling', () => {
      render(
        <CodeGroup label="/api/test" targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const label = screen.getByText('/api/test')
      expect(label.className).toContain('font-mono')
      expect(label.className).toContain('text-xs')
    })
  })

  describe('CodeGroupHeader (via CodeGroup with multiple tabs)', () => {
    it('should render tab list for multiple examples', () => {
      const examples = [
        { title: 'cURL', code: 'curl example' },
        { title: 'Node.js', code: 'node example' },
      ]
      render(
        <CodeGroup targetCode={examples}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('should style active tab differently', () => {
      const examples = [
        { title: 'Active', code: 'active code' },
        { title: 'Inactive', code: 'inactive code' },
      ]
      render(
        <CodeGroup targetCode={examples}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const activeTab = screen.getByRole('tab', { name: 'Active' })
      expect(activeTab.className).toContain('border-emerald-500')
      expect(activeTab.className).toContain('text-emerald-400')
    })

    it('should have header background styling', () => {
      const examples = [
        { title: 'Tab1', code: 'code1' },
        { title: 'Tab2', code: 'code2' },
      ]
      const { container } = render(
        <CodeGroup targetCode={examples}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const header = container.querySelector('.bg-zinc-800')
      expect(header).toBeInTheDocument()
    })
  })

  describe('CodePanel (via CodeGroup)', () => {
    it('should render code in pre element', () => {
      render(
        <CodeGroup targetCode="pre content">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('pre content').closest('pre')
      expect(preElement).toBeInTheDocument()
    })

    it('should have text-white class on pre', () => {
      render(
        <CodeGroup targetCode="white text">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('white text').closest('pre')
      expect(preElement?.className).toContain('text-white')
    })

    it('should have text-xs class on pre', () => {
      render(
        <CodeGroup targetCode="small text">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('small text').closest('pre')
      expect(preElement?.className).toContain('text-xs')
    })

    it('should have overflow-x-auto on pre', () => {
      render(
        <CodeGroup targetCode="scrollable">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('scrollable').closest('pre')
      expect(preElement?.className).toContain('overflow-x-auto')
    })

    it('should have p-4 padding on pre', () => {
      render(
        <CodeGroup targetCode="padded">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('padded').closest('pre')
      expect(preElement?.className).toContain('p-4')
    })
  })

  describe('ClipboardIcon (via CopyButton in CodeGroup)', () => {
    it('should render clipboard icon in copy button', () => {
      render(
        <CodeGroup targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const copyButton = screen.getByRole('button')
      const svg = copyButton.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('viewBox', '0 0 20 20')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string targetCode', () => {
      render(
        <CodeGroup targetCode="">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      // Should render copy button even with empty code
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle targetCode with special characters', () => {
      const specialCode = '<div class="test">&amp;</div>'
      render(
        <CodeGroup targetCode={specialCode}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText(specialCode)).toBeInTheDocument()
    })

    it('should handle multiline targetCode', () => {
      const multilineCode = `line1
line2
line3`
      render(
        <CodeGroup targetCode={multilineCode}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      // Multiline code should be rendered - use a partial match
      expect(screen.getByText(/line1/)).toBeInTheDocument()
      expect(screen.getByText(/line2/)).toBeInTheDocument()
      expect(screen.getByText(/line3/)).toBeInTheDocument()
    })

    it('should handle examples with tag property', () => {
      const examples = [
        { title: 'Example', tag: 'v1', code: 'versioned code' },
      ]
      render(
        <CodeGroup targetCode={examples}>
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText('versioned code')).toBeInTheDocument()
    })
  })
})
