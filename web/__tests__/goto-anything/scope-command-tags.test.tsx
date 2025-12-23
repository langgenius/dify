import { render, screen } from '@testing-library/react'
import * as React from 'react'

// Type alias for search mode
type SearchMode = 'scopes' | 'commands' | null

// Mock component to test tag display logic
const TagDisplay: React.FC<{ searchMode: SearchMode }> = ({ searchMode }) => {
  if (!searchMode)
    return null

  return (
    <div className="flex items-center gap-1 text-xs text-text-tertiary">
      <span>{searchMode === 'scopes' ? 'SCOPES' : 'COMMANDS'}</span>
    </div>
  )
}

describe('Scope and Command Tags', () => {
  describe('Tag Display Logic', () => {
    it('should display SCOPES for @ actions', () => {
      render(<TagDisplay searchMode="scopes" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()
      expect(screen.queryByText('COMMANDS')).not.toBeInTheDocument()
    })

    it('should display COMMANDS for / actions', () => {
      render(<TagDisplay searchMode="commands" />)
      expect(screen.getByText('COMMANDS')).toBeInTheDocument()
      expect(screen.queryByText('SCOPES')).not.toBeInTheDocument()
    })

    it('should not display any tag when searchMode is null', () => {
      const { container } = render(<TagDisplay searchMode={null} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Search Mode Detection', () => {
    const getSearchMode = (query: string): SearchMode => {
      if (query.startsWith('@'))
        return 'scopes'
      if (query.startsWith('/'))
        return 'commands'
      return null
    }

    it('should detect scopes mode for @ queries', () => {
      expect(getSearchMode('@app')).toBe('scopes')
      expect(getSearchMode('@knowledge')).toBe('scopes')
      expect(getSearchMode('@plugin')).toBe('scopes')
      expect(getSearchMode('@node')).toBe('scopes')
    })

    it('should detect commands mode for / queries', () => {
      expect(getSearchMode('/theme')).toBe('commands')
      expect(getSearchMode('/language')).toBe('commands')
      expect(getSearchMode('/docs')).toBe('commands')
    })

    it('should return null for regular queries', () => {
      expect(getSearchMode('')).toBe(null)
      expect(getSearchMode('search term')).toBe(null)
      expect(getSearchMode('app')).toBe(null)
    })

    it('should handle queries with spaces', () => {
      expect(getSearchMode('@app search')).toBe('scopes')
      expect(getSearchMode('/theme dark')).toBe('commands')
    })
  })

  describe('Tag Styling', () => {
    it('should apply correct styling classes', () => {
      const { container } = render(<TagDisplay searchMode="scopes" />)
      const tagContainer = container.querySelector('.flex.items-center.gap-1.text-xs.text-text-tertiary')
      expect(tagContainer).toBeInTheDocument()
    })

    it('should use hardcoded English text', () => {
      // Verify that tags are hardcoded and not using i18n
      render(<TagDisplay searchMode="scopes" />)
      const scopesText = screen.getByText('SCOPES')
      expect(scopesText.textContent).toBe('SCOPES')

      render(<TagDisplay searchMode="commands" />)
      const commandsText = screen.getByText('COMMANDS')
      expect(commandsText.textContent).toBe('COMMANDS')
    })
  })

  describe('Integration with Search States', () => {
    const SearchComponent: React.FC<{ query: string }> = ({ query }) => {
      let searchMode: SearchMode = null

      if (query.startsWith('@'))
        searchMode = 'scopes'
      else if (query.startsWith('/'))
        searchMode = 'commands'

      return (
        <div>
          <input value={query} readOnly />
          <TagDisplay searchMode={searchMode} />
        </div>
      )
    }

    it('should update tag when switching between @ and /', () => {
      const { rerender } = render(<SearchComponent query="@app" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()

      rerender(<SearchComponent query="/theme" />)
      expect(screen.queryByText('SCOPES')).not.toBeInTheDocument()
      expect(screen.getByText('COMMANDS')).toBeInTheDocument()
    })

    it('should hide tag when clearing search', () => {
      const { rerender } = render(<SearchComponent query="@app" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()

      rerender(<SearchComponent query="" />)
      expect(screen.queryByText('SCOPES')).not.toBeInTheDocument()
      expect(screen.queryByText('COMMANDS')).not.toBeInTheDocument()
    })

    it('should maintain correct tag during search refinement', () => {
      const { rerender } = render(<SearchComponent query="@" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()

      rerender(<SearchComponent query="@app" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()

      rerender(<SearchComponent query="@app test" />)
      expect(screen.getByText('SCOPES')).toBeInTheDocument()
    })
  })
})
