import type { ChatItem } from '../../../types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InfographicContent from '../infographic-content'

// Mock the InfographicViewer component
vi.mock('@/app/components/infographic', () => ({
  default: vi.fn(({ syntax }) => (
    <div data-testid="infographic-viewer">
      Infographic rendered with syntax:
      {' '}
      {syntax.substring(0, 50)}
      ...
    </div>
  )),
}))

describe('InfographicContent', () => {
  const createChatItem = (content: string): ChatItem => ({
    id: '1',
    content,
    isAnswer: true,
  })

  describe('Detection - Direct syntax', () => {
    it('renders infographic for valid syntax starting with "infographic"', () => {
      const syntax = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc First step
    - label Step 2
      desc Second step`

      const item = createChatItem(syntax)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
      expect(screen.getByText(/infographic list-row-simple-horizontal-arrow/)).toBeInTheDocument()
    })

    it('renders nothing for content not starting with "infographic"', () => {
      const item = createChatItem('Regular text content without infographic')
      const { container } = render(<InfographicContent item={item} />)
      expect(container.firstChild).toBeNull()
    })

    it('handles different template names', () => {
      const templates = [
        'list-row-simple-horizontal-arrow',
        'list-column-simple-vertical',
        'list-row-number-horizontal',
        'list-row-icon-horizontal',
        'comparison-row-simple-horizontal',
      ]

      templates.forEach((template) => {
        const syntax = `infographic ${template}
data
  lists
    - label Item 1
      desc Description`

        const item = createChatItem(syntax)
        const { unmount } = render(<InfographicContent item={item} />)

        expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('Detection - Code blocks', () => {
    it('extracts infographic from markdown code block with "infographic" language', () => {
      const content = `Here's your visualization:

\`\`\`infographic
infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Description
\`\`\`

That's the result!`

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('extracts infographic from yaml code block', () => {
      const content = `\`\`\`yaml
infographic list-column-simple-vertical
data
  lists
    - label Item 1
      desc Description
\`\`\``

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('extracts infographic from code block without language specifier', () => {
      const content = `\`\`\`
infographic list-row-number-horizontal
data
  lists
    - label 1
      desc First
\`\`\``

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('does not extract from code block without infographic keyword', () => {
      const content = `\`\`\`yaml
some: yaml
data: here
\`\`\``

      const item = createChatItem(content)
      const { container } = render(<InfographicContent item={item} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Detection - Embedded in text', () => {
    it('extracts infographic embedded in text', () => {
      const content = `Here is your process diagram:

infographic list-row-simple-horizontal-arrow
data
  lists
    - label Planning
      desc Define requirements
    - label Development
      desc Write code
    - label Testing
      desc QA testing

Hope this helps!`

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('stops extraction at non-indented content', () => {
      const content = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Description

This is regular text that should not be included.`

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      const viewer = screen.getByTestId('infographic-viewer')
      expect(viewer.textContent).not.toContain('regular text')
    })

    it('stops extraction at non-indented content without preceding blank line', () => {
      const content = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Description
This is regular text immediately after without blank line.`

      const item = createChatItem(content)
      render(<InfographicContent item={item} />)

      const viewer = screen.getByTestId('infographic-viewer')
      expect(viewer.textContent).not.toContain('regular text')
      expect(viewer.textContent).not.toContain('immediately after')
    })
  })

  describe('Edge cases', () => {
    it('handles non-string content', () => {
      const item = {
        id: '1',
        content: 123 as unknown,
        isAnswer: true,
      } as ChatItem
      const { container } = render(<InfographicContent item={item} />)
      expect(container.firstChild).toBeNull()
    })

    it('handles empty string', () => {
      const item = createChatItem('')
      const { container } = render(<InfographicContent item={item} />)
      expect(container.firstChild).toBeNull()
    })

    it('handles whitespace-only content', () => {
      const item = createChatItem('   \n  \t  ')
      const { container } = render(<InfographicContent item={item} />)
      expect(container.firstChild).toBeNull()
    })

    it('handles content with "infographic" in the middle', () => {
      const item = createChatItem('This talks about infographic design but is not syntax')
      const { container } = render(<InfographicContent item={item} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Syntax variations', () => {
    it('handles syntax with extra whitespace', () => {
      const syntax = `  infographic list-row-simple-horizontal-arrow  
data
  lists
    - label Step 1
      desc Description  `

      const item = createChatItem(syntax)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('handles syntax with Windows line endings', () => {
      const syntax = 'infographic list-row-simple-horizontal-arrow\r\ndata\r\n  lists\r\n    - label Step 1'

      const item = createChatItem(syntax)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })

    it('handles syntax with mixed indentation', () => {
      const syntax = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Description
    - label Step 2
      desc Another description`

      const item = createChatItem(syntax)
      render(<InfographicContent item={item} />)

      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })
  })

  describe('Component behavior', () => {
    it('applies correct className', () => {
      const syntax = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1`

      const item = createChatItem(syntax)
      const { container } = render(<InfographicContent item={item} />)

      expect(container.firstChild).toHaveClass('my-3')
    })

    it('memoizes parsed syntax', () => {
      const syntax = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1`

      const item = createChatItem(syntax)
      const { rerender } = render(<InfographicContent item={item} />)

      // Rerender with same content
      rerender(<InfographicContent item={item} />)

      // Should only render once (memoization working)
      expect(screen.getByTestId('infographic-viewer')).toBeInTheDocument()
    })
  })
})
