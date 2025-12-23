import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Command } from 'cmdk'
import CommandSelector from './command-selector'
import type { ActionItem } from './actions/types'

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
  test('should list contextual search actions and notify selection', async () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter='app'
          originalQuery='@app'
        />
      </Command>,
    )

    const actionButton = screen.getByText('app.gotoAnything.actions.searchApplicationsDesc')
    await userEvent.click(actionButton)

    expect(onSelect).toHaveBeenCalledWith('@app')
  })

  test('should render slash commands when query starts with slash', async () => {
    const actions = createActions()
    const onSelect = vi.fn()

    render(
      <Command>
        <CommandSelector
          actions={actions}
          onCommandSelect={onSelect}
          searchFilter='zen'
          originalQuery='/zen'
        />
      </Command>,
    )

    const slashItem = await screen.findByText('app.gotoAnything.actions.zenDesc')
    await userEvent.click(slashItem)

    expect(onSelect).toHaveBeenCalledWith('/zen')
  })
})
