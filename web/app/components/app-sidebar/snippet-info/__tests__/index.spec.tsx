import type { SnippetDetail } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import SnippetInfo from '..'

vi.mock('../dropdown', () => ({
  default: () => <div data-testid="snippet-info-dropdown" />,
}))

const mockSnippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Social Media Repurposer',
  description: 'Turn one blog post into multiple social media variations.',
  author: 'Dify',
  updatedAt: '2026-03-25 10:00',
  usage: '12',
  icon: '🤖',
  iconBackground: '#F0FDF9',
  status: undefined,
}

describe('SnippetInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the collapsed and expanded sidebar header states.
  describe('Rendering', () => {
    it('should render the expanded snippet details and dropdown when expand is true', () => {
      render(<SnippetInfo expand={true} snippet={mockSnippet} />)

      expect(screen.getByText(mockSnippet.name)).toBeInTheDocument()
      expect(screen.getByText('snippet.typeLabel')).toBeInTheDocument()
      expect(screen.getByText(mockSnippet.description)).toBeInTheDocument()
      expect(screen.getByTestId('snippet-info-dropdown')).toBeInTheDocument()
    })

    it('should hide the expanded-only content when expand is false', () => {
      render(<SnippetInfo expand={false} snippet={mockSnippet} />)

      expect(screen.queryByText(mockSnippet.name)).not.toBeInTheDocument()
      expect(screen.queryByText('snippet.typeLabel')).not.toBeInTheDocument()
      expect(screen.queryByText(mockSnippet.description)).not.toBeInTheDocument()
      expect(screen.queryByTestId('snippet-info-dropdown')).not.toBeInTheDocument()
    })
  })

  // Edge cases around optional snippet fields should not break the header layout.
  describe('Edge Cases', () => {
    it('should omit the description block when the snippet has no description', () => {
      render(
        <SnippetInfo
          expand={true}
          snippet={{ ...mockSnippet, description: '' }}
        />,
      )

      expect(screen.getByText(mockSnippet.name)).toBeInTheDocument()
      expect(screen.queryByText(mockSnippet.description)).not.toBeInTheDocument()
    })
  })
})
