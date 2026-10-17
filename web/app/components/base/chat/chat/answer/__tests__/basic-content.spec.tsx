import type { ChatItem } from '../../../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { render, screen } from '@testing-library/react'
import BasicContent from '../basic-content'

// Markdown parsing is independently covered; this suite owns annotation precedence and UNC preprocessing.
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content, className }: MarkdownProps) => (
    <div data-testid="basic-content-markdown" data-content={String(content)} className={className}>
      {String(content)}
    </div>
  ),
}))

describe('BasicContent', () => {
  const mockItem: ChatItem = {
    id: '1',
    content: 'Hello World',
    isAnswer: true,
  }

  it('renders logAnnotation content if present', () => {
    const itemWithAnnotation = {
      ...mockItem,
      annotation: {
        logAnnotation: {
          content: 'Annotated Content',
        },
      },
    }
    const { rerender } = render(<BasicContent item={mockItem} />)
    expect(screen.getByTestId('basic-content-markdown')).toHaveTextContent('Hello World')
    rerender(<BasicContent item={itemWithAnnotation as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', 'Annotated Content')
  })

  it('renders empty string if logAnnotation content is missing', () => {
    const itemWithEmptyAnnotation = {
      ...mockItem,
      annotation: {
        logAnnotation: {
          content: '',
        },
      },
    }
    const { rerender } = render(<BasicContent item={itemWithEmptyAnnotation as ChatItem} />)
    expect(screen.getByTestId('basic-content-markdown')).toHaveAttribute('data-content', '')

    const itemWithUndefinedAnnotation = {
      ...mockItem,
      annotation: {
        logAnnotation: {},
      },
    }
    rerender(<BasicContent item={itemWithUndefinedAnnotation as ChatItem} />)
    expect(screen.getByTestId('basic-content-markdown')).toHaveAttribute('data-content', '')
  })

  it('wraps Windows UNC paths in backticks', () => {
    const itemWithUNC = {
      ...mockItem,
      content: '\\\\server\\share\\file.txt',
    }
    render(<BasicContent item={itemWithUNC as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', '`\\\\server\\share\\file.txt`')
  })

  it('does not wrap content in backticks if it already is', () => {
    const itemWithBackticks = {
      ...mockItem,
      content: '`\\\\server\\share\\file.txt`',
    }
    render(<BasicContent item={itemWithBackticks as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', '`\\\\server\\share\\file.txt`')
  })

  it('does not wrap backslash strings that are not UNC paths', () => {
    const itemWithBackslashes = {
      ...mockItem,
      content: '\\not-a-unc',
    }
    render(<BasicContent item={itemWithBackslashes as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', '\\not-a-unc')
  })
})
