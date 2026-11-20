import type { PropsWithChildren } from 'react'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import StreamdownWrapper from '../streamdown-wrapper'

const TILDE_RANGE_RE = /0\.3~8mm/
const INLINE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAADZElEQVR4nOyYQWgiVxzGv+0k5CATuyasmWqT0oMNMYfVtQeRrC0kutTdWkFITAmm4E3oIYfeCmlKe8+hNEi7uTW4JGCkuKYNxNDuoUSFpUlbskS0a6IrC9tmA0ndMq8Mzzqro46mpc1hfgzD8z/f431+838+sIsQgovEC/+3gXoUQ3IohuRQDMmhGJJDMSSHYkgOxZAcXdLS4eHh1tZW9WN3dzfHcaOjoxqNRir+7Sm+/QGvG/EKV1N/8BCpn/AnL4xdNlzubdsRkRCLxaQyhmGcTmcqlaoTez8guEZeulFT/PBzcski1Ol1f1+6SFMaJFTF7XazLFsul7PZbDKZ3NjYSCQS0WjU4XBUNX88E+7lZ+Kse/fx8RfQX8EblkrlRbbteFontL8vfrXd3V2DwQBgYGDg5OSkWi88Jp/dIT8+EKd/eltI5e25DlJpN6HnMRqN4XDYZDIVi8VIJPKm491ESgzg8e/C4O49PHmK1M/COP8IX8UrghtW/pu7d3iet9lsQ0NDtLi5uVkqlQwGg8ViOU9ClJGREQDBYDD2vdgiuEbeel94etVXU3y+h6xWK4C5uUpuZ2dnvb1Cn6+srNQt0dm2Hx4eBpDNZnVX4L8pXKbXxKe3rguVq8KLxcvaisB/E5dZTE1NAYhGo1S5vb19fHzMsqzb7a5fo6OEJicnATidzmrlky/FhCgfhRr00NHREcMwAPb29gghwWAQwOzsrHT1zhLK5XIAOI7raBadYrfbAUQiEZ7n19fXAczMzEiVHRgqFArpdBqA2Wzu1BAAn89H31oymczn8zqdjlo8p6HT09NAIFAul3t6erxe7zkMeTwehmF2dnZCoRD1R19iHa22/erqqlarJYQcHByEw+FMJgNgfn6e47ivv0PpiaChm/zhI9yu9CvSvwj3X4ti5R07NGr09fVNTEzE4/Hl5eVqYA1o0dR1qNXqxcVFqrG+13iHN9v2FGqF/qpJ16U0SEiv1wcCATHDrq7+/n6z2exwOFQqFS3eug7jqy3CrUHz98k6NjZGB9PT003VzZz+u2QymaWlJZfLRc/pXC7XTPkfGVpbW6tGsLCw0ELZ7ln2DxkcHPT7/SqVyuPxjI+Pt1BeUv6wkkExJIdiSA7FkByKITkUQ3IohuS4cIb+CgAA///1U72NT4oCcgAAAABJRU5ErkJggg=='

const mockedConfig = vi.hoisted(() => ({ allowUnsafeDataScheme: false }))

// Keep the real configuration and only make the data-scheme flag switchable:
// the wrapper reads it on every render, so a getter lets one file cover both
// sides of the flag without resetting modules or re-importing the component.
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return Object.defineProperty({ ...actual }, 'ALLOW_UNSAFE_DATA_SCHEME', {
    get: () => mockedConfig.allowUnsafeDataScheme,
    enumerable: true,
  })
})

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

  describe('Inline data: images', () => {
    afterEach(() => {
      mockedConfig.allowUnsafeDataScheme = false
    })

    it('should render an inline base64 image when ALLOW_UNSAFE_DATA_SCHEME is enabled', () => {
      // Arrange - the sanitize schema has to admit the scheme for the src to
      // survive until rehype-harden, which is the stage that allows data images
      mockedConfig.allowUnsafeDataScheme = true

      // Act
      render(<StreamdownWrapper latexContent={`![dify-icon](${INLINE_PNG})`} />)

      // Assert
      expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', INLINE_PNG)
    })

    it('should keep blocking inline base64 images when the flag is disabled', () => {
      // Act - default configuration
      render(<StreamdownWrapper latexContent={`![dify-icon](${INLINE_PNG})`} />)

      // Assert
      expect(screen.queryByTestId('gallery-image')).toBeNull()
      expect(screen.getByText('[Image blocked: dify-icon]')).toBeInTheDocument()
    })

    it('should keep blocking data: links even when the flag is enabled', () => {
      // Arrange - only image sources are widened, never link targets
      mockedConfig.allowUnsafeDataScheme = true

      // Act
      render(<StreamdownWrapper latexContent={'[open](data:text/html;base64,PHNjcmlwdD4=)'} />)

      // Assert - the link is dropped instead of becoming an anchor; the
      // renderer keeps the label and flags the blocked target
      expect(screen.queryByRole('link')).toBeNull()
      expect(document.body.textContent).toContain('open')
    })
  })

  describe('Soft line breaks', () => {
    it('should render soft line breaks by default', () => {
      render(<StreamdownWrapper latexContent={'first line\nsecond line'} />)
      expect(document.querySelector('br')).not.toBeNull()
    })

    it('should collapse soft line breaks when disabled and preserve paragraph breaks', () => {
      render(
        <StreamdownWrapper
          latexContent={'first line\nsecond line\n\nnext paragraph'}
          renderSoftBreaks={false}
        />,
      )
      expect(document.querySelector('br')).toBeNull()
      expect(screen.getByText('first line second line')).toBeInTheDocument()
      expect(screen.getByText('next paragraph')).toBeInTheDocument()
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
