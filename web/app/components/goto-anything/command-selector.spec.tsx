import type { ActionItem } from './actions/types'
import { render, screen } from '@testing-library/react'
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

const createActions = (): Record<string, ActionItem> => ({
  app: {
    key: '@app',
    shortcut: '@app',
    title: 'Apps',
    search: vi.fn(),
    description: '',
  } as ActionItem,
  plugin: {
    key: '@plugin',
    shortcut: '@plugin',
    title: 'Plugins',
    search: vi.fn(),
    description: '',
  } as ActionItem,
})

describe('CommandSelector', () => {
  it('should list contextual search actions and notify selection', async () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter="app"
          originalQuery="@app"
        />
      </Command>,
    )

    const actionButton = screen.getByText('app.gotoAnything.actions.searchApplicationsDesc')
    await userEvent.click(actionButton)

    expect(onSelect).toHaveBeenCalledWith('@app')
  })

  it('should render slash commands when query starts with slash', async () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter="zen"
          originalQuery="/zen"
        />
      </Command>,
    )

    const slashItem = await screen.findByText('app.gotoAnything.actions.zenDesc')
    await userEvent.click(slashItem)

    expect(onSelect).toHaveBeenCalledWith('/zen')
  })

  it('should show all slash commands when no filter provided', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="/"
        />
      </Command>,
    )

    // Should show the zen command from mock
    expect(screen.getByText('/zen')).toBeInTheDocument()
  })

  it('should exclude slash action when in @ mode', () => {
    const actions = {
      ...createActions(),
      slash: {
        key: '/',
        shortcut: '/',
        title: 'Slash',
        search: vi.fn(),
        description: '',
      } as ActionItem,
    }
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
        />
      </Command>,
    )

    // Should show @ commands but not /
    expect(screen.getByText('@app')).toBeInTheDocument()
    expect(screen.queryByText('/')).not.toBeInTheDocument()
  })

  it('should show all actions when no filter in @ mode', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
        />
      </Command>,
    )

    expect(screen.getByText('@app')).toBeInTheDocument()
    expect(screen.getByText('@plugin')).toBeInTheDocument()
  })

  it('should set default command value when items exist but value does not', () => {
    const actions = createActions()
    const onSelect = vi.fn()
    const onCommandValueChange = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
          commandValue="non-existent"
          onCommandValueChange={onCommandValueChange}
        />
      </Command>,
    )

    expect(onCommandValueChange).toHaveBeenCalledWith('@app')
  })

  it('should NOT set command value when value already exists in items', () => {
    const actions = createActions()
    const onSelect = vi.fn()
    const onCommandValueChange = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
          commandValue="@app"
          onCommandValueChange={onCommandValueChange}
        />
      </Command>,
    )

    expect(onCommandValueChange).not.toHaveBeenCalled()
  })

  it('should show no matching commands message when filter has no results', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter="nonexistent"
          originalQuery="@nonexistent"
        />
      </Command>,
    )

    expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.tryDifferentSearch')).toBeInTheDocument()
  })

  it('should show no matching commands for slash mode with no results', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter="nonexistentcommand"
          originalQuery="/nonexistentcommand"
        />
      </Command>,
    )

    expect(screen.getByText('app.gotoAnything.noMatchingCommands')).toBeInTheDocument()
  })

  it('should render description for @ commands', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
        />
      </Command>,
    )

    expect(screen.getByText('app.gotoAnything.actions.searchApplicationsDesc')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.actions.searchPluginsDesc')).toBeInTheDocument()
  })

  it('should render group header for @ mode', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="@"
        />
      </Command>,
    )

    expect(screen.getByText('app.gotoAnything.selectSearchType')).toBeInTheDocument()
  })

  it('should render group header for slash mode', () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter=""
          originalQuery="/"
        />
      </Command>,
    )

    expect(screen.getByText('app.gotoAnything.groups.commands')).toBeInTheDocument()
  })
})
