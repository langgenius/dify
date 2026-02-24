import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SubmittedContent from './submitted-content'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="mock-markdown">{content}</div>,
}))

describe('SubmittedContent', () => {
  it('should render Markdown with the provided content', () => {
    const content = '## Test Content'
    render(<SubmittedContent content={content} />)

    expect(screen.getByTestId('submitted-content')).toBeInTheDocument()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent(content)
  })
})
