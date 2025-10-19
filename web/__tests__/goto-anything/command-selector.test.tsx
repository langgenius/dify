import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import CommandSelector from '../../app/components/goto-anything/command-selector'
import type { ActionItem } from '../../app/components/goto-anything/actions/types'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('cmdk', () => ({
  Command: {
    Group: ({ children, className }: any) => <div className={className}>{children}</div>,
    Item: ({ children, onSelect, value, className }: any) => (
      <div
        className={className}
        onClick={() => onSelect?.()}
        data-value={value}
        data-testid={`command-item-${value}`}
      >
        {children}
      </div>
    ),
  },
}))

describe('CommandSelector', () => {
  const mockActions: Record<string, ActionItem> = {
    app: {
      key: '@app',
      shortcut: '@app',
      title: 'Search Applications',
      description: 'Search apps',
      search: jest.fn(),
    },
    knowledge: {
      key: '@knowledge',
      shortcut: '@kb',
      title: 'Search Knowledge',
      description: 'Search knowledge bases',
      search: jest.fn(),
    },
    plugin: {
      key: '@plugin',
      shortcut: '@plugin',
      title: 'Search Plugins',
      description: 'Search plugins',
      search: jest.fn(),
    },
    node: {
      key: '@node',
      shortcut: '@node',
      title: 'Search Nodes',
      description: 'Search workflow nodes',
      search: jest.fn(),
    },
  }

  const mockOnCommandSelect = jest.fn()
  const mockOnCommandValueChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render all actions when no filter is provided', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@plugin')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@node')).toBeInTheDocument()
    })

    it('should render empty filter as showing all actions', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@plugin')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@node')).toBeInTheDocument()
    })
  })

  describe('Filtering Functionality', () => {
    it('should filter actions based on searchFilter - single match', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="k"
        />,
      )

      expect(screen.queryByTestId('command-item-@app')).not.toBeInTheDocument()
      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@plugin')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@node')).not.toBeInTheDocument()
    })

    it('should filter actions with multiple matches', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="p"
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@kb')).not.toBeInTheDocument()
      expect(screen.getByTestId('command-item-@plugin')).toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@node')).not.toBeInTheDocument()
    })

    it('should be case-insensitive when filtering', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="APP"
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@kb')).not.toBeInTheDocument()
    })

    it('should match partial strings', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="od"
        />,
      )

      expect(screen.queryByTestId('command-item-@app')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@kb')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@plugin')).not.toBeInTheDocument()
      expect(screen.getByTestId('command-item-@node')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no matches found', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="xyz"
        />,
      )

      expect(screen.queryByTestId('command-item-@app')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@kb')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@plugin')).not.toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@node')).not.toBeInTheDocument()

      expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
      expect(screen.getByText('app.gotoAnything.tryDifferentSearch')).toBeInTheDocument()
    })

    it('should not show empty state when filter is empty', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
        />,
      )

      expect(screen.queryByText('app.gotoAnything.noMatchingCommands')).not.toBeInTheDocument()
    })
  })

  describe('Selection and Highlight Management', () => {
    it('should call onCommandValueChange when filter changes and first item differs', () => {
      const { rerender } = render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
          commandValue="@app"
          onCommandValueChange={mockOnCommandValueChange}
        />,
      )

      rerender(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="k"
          commandValue="@app"
          onCommandValueChange={mockOnCommandValueChange}
        />,
      )

      expect(mockOnCommandValueChange).toHaveBeenCalledWith('@kb')
    })

    it('should not call onCommandValueChange if current value still exists', () => {
      const { rerender } = render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
          commandValue="@app"
          onCommandValueChange={mockOnCommandValueChange}
        />,
      )

      rerender(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="a"
          commandValue="@app"
          onCommandValueChange={mockOnCommandValueChange}
        />,
      )

      expect(mockOnCommandValueChange).not.toHaveBeenCalled()
    })

    it('should handle onCommandSelect callback correctly', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="k"
        />,
      )

      const knowledgeItem = screen.getByTestId('command-item-@kb')
      fireEvent.click(knowledgeItem)

      expect(mockOnCommandSelect).toHaveBeenCalledWith('@kb')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty actions object', () => {
      render(
        <CommandSelector
          actions={{}}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
        />,
      )

      expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
    })

    it('should handle special characters in filter', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="@"
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@plugin')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@node')).toBeInTheDocument()
    })

    it('should handle undefined onCommandValueChange gracefully', () => {
      const { rerender } = render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter=""
        />,
      )

      expect(() => {
        rerender(
          <CommandSelector
            actions={mockActions}
            onCommandSelect={mockOnCommandSelect}
            searchFilter="k"
          />,
        )
      }).not.toThrow()
    })
  })

  describe('Backward Compatibility', () => {
    it('should work without searchFilter prop (backward compatible)', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
        />,
      )

      expect(screen.getByTestId('command-item-@app')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@plugin')).toBeInTheDocument()
      expect(screen.getByTestId('command-item-@node')).toBeInTheDocument()
    })

    it('should work without commandValue and onCommandValueChange props', () => {
      render(
        <CommandSelector
          actions={mockActions}
          onCommandSelect={mockOnCommandSelect}
          searchFilter="k"
        />,
      )

      expect(screen.getByTestId('command-item-@kb')).toBeInTheDocument()
      expect(screen.queryByTestId('command-item-@app')).not.toBeInTheDocument()
    })
  })
})
