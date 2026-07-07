import { render, screen } from '@testing-library/react'
import DOMPurify from 'dompurify'
import { validateDirectiveProps } from '../components/markdown-with-directive-schema'
import WithIconCardItem from '../components/with-icon-card-item'
import WithIconCardList from '../components/with-icon-card-list'
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
      expect(validateDirectiveProps('withiconcarditem', { icon: 'https://example.com/icon.png' })).toBe(true)
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

      const isValid = validateDirectiveProps('withiconcarditem', { icon: 'ftp://example.com/icon.png' })

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

  // Validate WithIconCardList rendering and class merge behavior.
  describe('WithIconCardList component', () => {
    it('should render children and merge className with base class', () => {
      const { container } = render(
        <WithIconCardList className="custom-list-class">
          <span>List child</span>
        </WithIconCardList>,
      )

      expect(screen.getByText('List child')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('space-y-1')
      expect(container.firstElementChild).toHaveClass('custom-list-class')
    })

    it('should render base class when className is not provided', () => {
      const { container } = render(
        <WithIconCardList>
          <span>Only base class</span>
        </WithIconCardList>,
      )

      expect(screen.getByText('Only base class')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('space-y-1')
    })
  })

  // Validate WithIconCardItem rendering and image prop forwarding.
  describe('WithIconCardItem component', () => {
    it('should render icon image and child content', () => {
      const { container } = render(
        <WithIconCardItem icon="https://example.com/icon.png">
          <span>Card item content</span>
        </WithIconCardItem>,
      )

      expectDecorativeIcon(container, 'https://example.com/icon.png')
      expect(screen.getByText('Card item content')).toBeInTheDocument()
    })
  })

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
      expect(list).toHaveClass('space-y-1')
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

    it('should call sanitizer and render based on sanitized markdown', () => {
      const sanitizeSpy = vi.spyOn(DOMPurify, 'sanitize')
        .mockReturnValue(':withiconcarditem[Sanitized]{icon="https://example.com/safe.png"}')

      const { container } = render(<MarkdownWithDirective markdown="<script>alert(1)</script>" />)

      expect(sanitizeSpy).toHaveBeenCalledWith('<script>alert(1)</script>', {
        ALLOWED_ATTR: [],
        ALLOWED_TAGS: [],
      })
      expect(screen.getByText('Sanitized')).toBeInTheDocument()
      expectDecorativeIcon(container, 'https://example.com/safe.png')
      sanitizeSpy.mockRestore()
    })

    it('should render markdown links without underline', () => {
      render(<MarkdownWithDirective markdown="[Langfuse](https://langfuse.com)" />)

      const link = screen.getByRole('link', { name: 'Langfuse' })
      expect(link).toHaveClass('text-text-accent')
      expect(link).toHaveStyle({ textDecoration: 'none' })
    })

    it('should render empty output and skip sanitizer when markdown is empty', () => {
      const sanitizeSpy = vi.spyOn(DOMPurify, 'sanitize')
      const { container } = render(<MarkdownWithDirective markdown="" />)

      expect(sanitizeSpy).not.toHaveBeenCalled()
      expect(container).toBeEmptyDOMElement()
    })
  })
})
