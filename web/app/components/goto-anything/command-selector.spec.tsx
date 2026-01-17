import type { ScopeDescriptor } from './actions/scope-registry'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Command } from 'cmdk'
import * as React from 'react'
import CommandSelector from './command-selector'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
}))

const slashCommandsMock = [{
  name: 'zen',
  description: 'Zen mode',
  mode: 'direct',
  isAvailable: () => true,
}]

vi.mock('./actions/commands/registry', () => ({
  slashCommandRegistry: {
    getAvailableCommands: () => slashCommandsMock,
  },
}))

type CommandSelectorProps = React.ComponentProps<typeof CommandSelector>

const mockScopes: ScopeDescriptor[] = [
  {
    id: 'app',
    shortcut: '@app',
    title: 'Search Applications',
    description: 'Search apps',
    search: vi.fn(),
  },
  {
    id: 'knowledge',
    shortcut: '@knowledge',
    title: 'Search Knowledge Bases',
    description: 'Search knowledge bases',
    search: vi.fn(),
  },
  {
    id: 'plugin',
    shortcut: '@plugin',
    title: 'Search Plugins',
    description: 'Search plugins',
    search: vi.fn(),
  },
  {
    id: 'workflow-node',
    shortcut: '@node',
    title: 'Search Nodes',
    description: 'Search workflow nodes',
    search: vi.fn(),
  },
]

const mockOnCommandSelect = vi.fn()
const mockOnCommandValueChange = vi.fn()

const buildCommandSelector = (props: Partial<CommandSelectorProps> = {}) => (
  <Command>
    <Command.List>
      <CommandSelector
        scopes={mockScopes}
        onCommandSelect={mockOnCommandSelect}
        {...props}
      />
    </Command.List>
  </Command>
)

const renderCommandSelector = (props: Partial<CommandSelectorProps> = {}) => {
  return render(buildCommandSelector(props))
}

describe('CommandSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render all scopes when no filter is provided', () => {
      renderCommandSelector()

      expect(screen.getByText('@app')).toBeInTheDocument()
      expect(screen.getByText('@knowledge')).toBeInTheDocument()
      expect(screen.getByText('@plugin')).toBeInTheDocument()
      expect(screen.getByText('@node')).toBeInTheDocument()
    })

    it('should render empty filter as showing all scopes', () => {
      renderCommandSelector({ searchFilter: '' })

      expect(screen.getByText('@app')).toBeInTheDocument()
      expect(screen.getByText('@knowledge')).toBeInTheDocument()
      expect(screen.getByText('@plugin')).toBeInTheDocument()
      expect(screen.getByText('@node')).toBeInTheDocument()
    })
  })

  describe('Filtering Functionality', () => {
    it('should filter scopes based on searchFilter - single match', () => {
      renderCommandSelector({ searchFilter: 'k' })

      expect(screen.queryByText('@app')).not.toBeInTheDocument()
      expect(screen.getByText('@knowledge')).toBeInTheDocument()
      expect(screen.queryByText('@plugin')).not.toBeInTheDocument()
      expect(screen.queryByText('@node')).not.toBeInTheDocument()
    })

    it('should filter scopes with multiple matches', () => {
      renderCommandSelector({ searchFilter: 'p' })

      expect(screen.getByText('@app')).toBeInTheDocument()
      expect(screen.queryByText('@knowledge')).not.toBeInTheDocument()
      expect(screen.getByText('@plugin')).toBeInTheDocument()
      expect(screen.queryByText('@node')).not.toBeInTheDocument()
    })

    it('should be case-insensitive when filtering', () => {
      renderCommandSelector({ searchFilter: 'APP' })

      expect(screen.getByText('@app')).toBeInTheDocument()
      expect(screen.queryByText('@knowledge')).not.toBeInTheDocument()
    })

    it('should match partial strings', () => {
      renderCommandSelector({ searchFilter: 'od' })

      expect(screen.queryByText('@app')).not.toBeInTheDocument()
      expect(screen.queryByText('@knowledge')).not.toBeInTheDocument()
      expect(screen.queryByText('@plugin')).not.toBeInTheDocument()
      expect(screen.getByText('@node')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no matches found', () => {
      renderCommandSelector({ searchFilter: 'xyz' })

      expect(screen.queryByText('@app')).not.toBeInTheDocument()
      expect(screen.queryByText('@knowledge')).not.toBeInTheDocument()
      expect(screen.queryByText('@plugin')).not.toBeInTheDocument()
      expect(screen.queryByText('@node')).not.toBeInTheDocument()

      expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
      expect(screen.getByText('app.gotoAnything.tryDifferentSearch')).toBeInTheDocument()
    })

    it('should not show empty state when filter is empty', () => {
      renderCommandSelector({ searchFilter: '' })

      expect(screen.queryByText('app.gotoAnything.noMatchingCommands')).not.toBeInTheDocument()
    })
  })

  describe('Selection and Highlight Management', () => {
    it('should call onCommandValueChange when filter changes and first item differs', async () => {
      const { rerender } = renderCommandSelector({
        searchFilter: '',
        commandValue: '@app',
        onCommandValueChange: mockOnCommandValueChange,
      })

      rerender(buildCommandSelector({
        searchFilter: 'k',
        commandValue: '@app',
        onCommandValueChange: mockOnCommandValueChange,
      }))

      await waitFor(() => {
        expect(mockOnCommandValueChange).toHaveBeenCalledWith('@knowledge')
      })
    })

    it('should not call onCommandValueChange if current value still exists', async () => {
      const { rerender } = renderCommandSelector({
        searchFilter: '',
        commandValue: '@app',
        onCommandValueChange: mockOnCommandValueChange,
      })

      rerender(buildCommandSelector({
        searchFilter: 'a',
        commandValue: '@app',
        onCommandValueChange: mockOnCommandValueChange,
      }))

      await waitFor(() => {
        expect(mockOnCommandValueChange).not.toHaveBeenCalled()
      })
    })

    it('should handle onCommandSelect callback correctly', async () => {
      const user = userEvent.setup()
      renderCommandSelector({ searchFilter: 'k' })

      await user.click(screen.getByText('@knowledge'))

      expect(mockOnCommandSelect).toHaveBeenCalledWith('@knowledge')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty scopes array', () => {
      renderCommandSelector({ scopes: [] })

      expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
    })

    it('should handle special characters in filter', () => {
      renderCommandSelector({ searchFilter: '@' })

      expect(screen.getByText('@app')).toBeInTheDocument()
      expect(screen.getByText('@knowledge')).toBeInTheDocument()
      expect(screen.getByText('@plugin')).toBeInTheDocument()
      expect(screen.getByText('@node')).toBeInTheDocument()
    })

    it('should handle undefined onCommandValueChange gracefully', () => {
      const { rerender } = renderCommandSelector({ searchFilter: '' })

      expect(() => {
        rerender(buildCommandSelector({ searchFilter: 'k' }))
      }).not.toThrow()
    })
  })

  describe('User Interactions', () => {
    it('should list contextual scopes and notify selection', async () => {
      const user = userEvent.setup()
      renderCommandSelector({ searchFilter: 'app', originalQuery: '@app' })

      await user.click(screen.getByText('app.gotoAnything.actions.searchApplicationsDesc'))

      expect(mockOnCommandSelect).toHaveBeenCalledWith('@app')
    })

    it('should render slash commands when query starts with slash', async () => {
      const user = userEvent.setup()
      renderCommandSelector({ searchFilter: 'zen', originalQuery: '/zen' })

      const slashItem = await screen.findByText('app.gotoAnything.actions.zenDesc')
      await user.click(slashItem)

      expect(mockOnCommandSelect).toHaveBeenCalledWith('/zen')
    })
  })
})
