import { render, screen } from '@testing-library/react'
import { validateDirectiveProps } from '../components/markdown-with-directive-schema'
import { MarkdownWithDirective } from '../index'

const FOUR_COLON_RE = /:{4}/

function expectDecorativeIcon(container: HTMLElement, src: string) {
  const icon = container.querySelector('img')
  expect(icon).toBeInTheDocument()
  expect(icon).toHaveAttribute('src', src)
  expect(icon).toHaveAttribute('alt', '')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
}

describe('markdown-with-directive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Validate directive prop schemas and error paths.
  describe('Directive schema validation', () => {
    it('should return true when withiconcardlist props are valid', () => {
      expect(validateDirectiveProps('withiconcardlist', { className: 'custom-list' })).toBe(true)
    })

    it('should return true when withiconcarditem props are valid', () => {
      expect(
        validateDirectiveProps('withiconcarditem', { icon: 'https://example.com/icon.png' }),
      ).toBe(true)
    })

    it('should return false and log when directive name is unknown', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('unknown-directive', { className: 'custom-list' })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Unknown directive name.',
        expect.objectContaining({
          attributes: { className: 'custom-list' },
          directive: 'unknown-directive',
        }),
      )
    })

    it('should return false and log when withiconcarditem icon is not http/https', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('withiconcarditem', {
        icon: 'ftp://example.com/icon.png',
      })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Invalid directive props.',
        expect.objectContaining({
          attributes: { icon: 'ftp://example.com/icon.png' },
          directive: 'withiconcarditem',
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'icon',
            }),
          ]),
        }),
      )
    })

    it('should return false when extra props are provided to strict schema', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('withiconcardlist', {
        className: 'custom-list',
        extra: 'not-allowed',
      })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Invalid directive props.',
        expect.objectContaining({
          directive: 'withiconcardlist',
        }),
      )
    })
  })

  // Validate WithIconCardItem rendering and image prop forwarding.

  // Validate markdown parsing pipeline, sanitizer usage, and invalid fallback.
  describe('MarkdownWithDirective component', () => {
    it('should render directives when markdown is valid', () => {
      const markdown = [
        '::withiconcardlist {className="custom-list"}',
        ':withiconcarditem[Card Title] {icon="https://example.com/icon.png"} {className="custom-item"}',
        '::',
      ].join('\n')

      const { container } = render(<MarkdownWithDirective markdown={markdown} />)

      const list = container.querySelector('.custom-list')
      expect(list).toBeInTheDocument()
      expect(screen.getByText('Card Title')).toBeInTheDocument()
      expectDecorativeIcon(container, 'https://example.com/icon.png')
    })

    it('should replace output with invalid content when directive is unknown', () => {
      const markdown = ':unknown[Bad Content]{foo="bar"}'

      render(<MarkdownWithDirective markdown={markdown} />)

      expect(screen.getByText('invalid content')).toBeInTheDocument()
      expect(screen.queryByText('Bad Content')).not.toBeInTheDocument()
    })

    it('should replace output with invalid content when directive props are invalid', () => {
      const markdown = ':withiconcarditem[Invalid Icon]{icon="not-a-url"}'

      render(<MarkdownWithDirective markdown={markdown} />)

      expect(screen.getByText('invalid content')).toBeInTheDocument()
      expect(screen.queryByText('Invalid Icon')).not.toBeInTheDocument()
    })

    it('should not render trailing fence text for four-colon container directives', () => {
      const markdown = [
        '::::withiconcardlist {className="custom-list"}',
        ':withiconcarditem[Card Title]{icon="https://example.com/icon.png"}',
        '::::',
      ].join('\n')

      const { container } = render(<MarkdownWithDirective markdown={markdown} />)

      expect(screen.getByText('Card Title')).toBeInTheDocument()
      expect(screen.queryByText(FOUR_COLON_RE)).not.toBeInTheDocument()
      expect(container.textContent).not.toContain('::::')
    })

    it('should retain safe external links with opener isolation', () => {
      render(<MarkdownWithDirective markdown="[Langfuse](https://langfuse.com)" />)

      const link = screen.getByRole('link', { name: 'Langfuse' })
      expect(link).toHaveAttribute('href', 'https://langfuse.com/')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render empty output when markdown is empty', () => {
      const { container } = render(<MarkdownWithDirective markdown="" />)

      expect(container).toBeEmptyDOMElement()
    })
  })
  it('removes raw script and event-handler HTML while preserving a safe directive', () => {
    const { container } = render(
      <MarkdownWithDirective
        markdown={
          '<script>alert(1)</script><img src="x" onerror="alert(2)">\n\n:withiconcarditem[Safe card]{icon="https://example.com/safe.png"}'
        }
      />,
    )
    expect(screen.getByText('Safe card')).toBeInTheDocument()
    expectDecorativeIcon(container, 'https://example.com/safe.png')
    expect(container.querySelector('script, [onerror]')).toBeNull()
  })
})
