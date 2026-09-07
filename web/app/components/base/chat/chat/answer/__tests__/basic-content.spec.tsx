import type { ChatItem } from '../../../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { render, screen } from '@testing-library/react'
import BasicContent from '../basic-content'

// Mock Markdown component used only in tests
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content, className }: MarkdownProps) => (
    <div data-testid="basic-content-markdown" data-content={String(content)} className={className}>
      {String(content)}
    </div>
  ),
}))

describe('BasicContent', () => {
  const mockItem = {
    id: '1',
    content: 'Hello World',
    isAnswer: true,
  }

  it('renders content correctly', () => {
    render(<BasicContent item={mockItem as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', 'Hello World')
  })

  it('resolves Workflow Agent knowledge receipts without accepting invented sources', () => {
    const id = `kfs_${'a'.repeat(32)}`
    const item: ChatItem = {
      ...mockItem,
      content: `[Manual](kfs://${id})`,
      citation: [
        {
          dataset_id: 'space',
          dataset_name: 'Docs',
          document_id: 'doc',
          document_name: 'Manual',
          data_source_type: 'knowledge_fs',
          content: 'evidence',
          segment_id: 'node',
          index_node_hash: 'hash',
          hit_count: 0,
          score: 0,
          word_count: 1,
          segment_position: 1,
          knowledge_fs_citation: {
            id,
            control_space_id: '00000000-0000-4000-8000-000000000001',
            space_name: 'Docs',
            node_id: 'node',
            document_asset_id: 'doc',
            artifact_hash: 'hash',
          },
        },
      ],
    }
    const { rerender } = render(<BasicContent item={item} />)
    expect(screen.getByTestId('basic-content-markdown')).toHaveAttribute(
      'data-content',
      `[Manual](#${id})`,
    )
    rerender(<BasicContent item={{ ...item, citation: [] }} />)
    expect(screen.getByTestId('basic-content-markdown')).toHaveAttribute('data-content', 'Manual')
  })

  it('renders logAnnotation content if present', () => {
    const itemWithAnnotation = {
      ...mockItem,
      annotation: {
        logAnnotation: {
          content: 'Annotated Content',
        },
      },
    }
    render(<BasicContent item={itemWithAnnotation as ChatItem} />)
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

  it('renders non-string content without attempting to wrap (covers typeof !== "string" branch)', () => {
    const itemWithNonStringContent = {
      ...mockItem,
      content: 12345,
    }
    render(<BasicContent item={itemWithNonStringContent as unknown as ChatItem} />)
    const markdown = screen.getByTestId('basic-content-markdown')
    expect(markdown).toHaveAttribute('data-content', '12345')
  })
})
