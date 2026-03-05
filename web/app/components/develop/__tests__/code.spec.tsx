import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Code, CodeGroup, Embed, Pre } from '../code'

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
}))

describe('code.tsx components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // jsdom does not implement scrollBy; mock it to prevent stderr noise
    window.scrollBy = vi.fn()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Code', () => {
    it('should render children as a code element', () => {
      render(<Code>const x = 1</Code>)
      const codeElement = screen.getByText('const x = 1')
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
    it('should render value prop as a span element', () => {
      render(<Embed value="embedded content">ignored children</Embed>)
      const span = screen.getByText('embedded content')
      expect(span.tagName).toBe('SPAN')
    })

    it('should pass through additional props', () => {
      render(<Embed value="content" data-testid="embed-test" className="embed-class">children</Embed>)
      const embed = screen.getByTestId('embed-test')
      expect(embed).toHaveClass('embed-class')
    })

    it('should render only value, not children', () => {
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
        await act(async () => {
          vi.runAllTimers()
        })

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
      it('should render title in an h3 heading', () => {
        render(
          <CodeGroup title="API Example" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        const h3 = screen.getByRole('heading', { level: 3 })
        expect(h3).toHaveTextContent('API Example')
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

      it('should render both tag and label together', () => {
        render(
          <CodeGroup tag="POST" label="/api/create" targetCode="code">
            <pre><code>fallback</code></pre>
          </CodeGroup>,
        )
        expect(screen.getByText('POST')).toBeInTheDocument()
        expect(screen.getByText('/api/create')).toBeInTheDocument()
      })
    })

    describe('CopyButton functionality', () => {
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
        await act(async () => {
          vi.runAllTimers()
        })

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
        await act(async () => {
          vi.runAllTimers()
        })

        const copyButton = screen.getByRole('button')
        await act(async () => {
          await user.click(copyButton)
        })

        await waitFor(() => {
          expect(screen.getByText('Copied!')).toBeInTheDocument()
        })

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
  })

  describe('Pre', () => {
    it('should wrap children in CodeGroup when outside CodeGroup context', () => {
      render(
        <Pre title="Pre Title">
          <pre><code>code</code></pre>
        </Pre>,
      )
      expect(screen.getByText('Pre Title')).toBeInTheDocument()
    })

    it('should return children directly when inside CodeGroup context', () => {
      render(
        <CodeGroup targetCode="outer code">
          <Pre>
            <code>inner code</code>
          </Pre>
        </CodeGroup>,
      )
      expect(screen.getByText('outer code')).toBeInTheDocument()
    })
  })

  describe('CodePanelHeader (via CodeGroup)', () => {
    it('should render when tag is provided', () => {
      render(
        <CodeGroup tag="GET" targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText('GET')).toBeInTheDocument()
    })

    it('should render when label is provided', () => {
      render(
        <CodeGroup label="/api/endpoint" targetCode="code">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      expect(screen.getByText('/api/endpoint')).toBeInTheDocument()
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
  })

  describe('CodePanel (via CodeGroup)', () => {
    it('should render code in a pre element', () => {
      render(
        <CodeGroup targetCode="pre content">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
      const preElement = screen.getByText('pre content').closest('pre')
      expect(preElement).toBeInTheDocument()
    })
  })

  describe('ClipboardIcon (via CopyButton)', () => {
    it('should render clipboard SVG icon in copy button', () => {
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

  describe('Edge Cases', () => {
    it('should handle empty string targetCode', () => {
      render(
        <CodeGroup targetCode="">
          <pre><code>fallback</code></pre>
        </CodeGroup>,
      )
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
