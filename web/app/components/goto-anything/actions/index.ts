/**
 * Goto Anything - Action System
 *
 * This file defines the action registry for the goto-anything search system.
 * Actions handle different types of searches: apps, knowledge bases, plugins, workflow nodes, and commands.
 *
 * ## How to Add a New Slash Command
 *
 * 1. **Create Command Handler File** (in `./commands/` directory):
 *    ```typescript
 *    // commands/my-command.ts
 *    import type { SlashCommandHandler } from './types'
 *    import type { CommandSearchResult } from '../types'
 *    import { registerCommands, unregisterCommands } from './command-bus'
 *
 *    interface MyCommandDeps {
 *      myService?: (data: any) => Promise<void>
 *    }
 *
 *    export const myCommand: SlashCommandHandler<MyCommandDeps> = {
 *      name: 'mycommand',
 *      aliases: ['mc'], // Optional aliases
 *      description: 'My custom command description',
 *
 *      async search(args: string, locale: string = 'en') {
 *        // Return search results based on args
 *        return [{
 *          id: 'my-result',
 *          title: 'My Command Result',
 *          description: 'Description of the result',
 *          type: 'command' as const,
 *          data: { command: 'my.action', args: { value: args } }
 *        }]
 *      },
 *
 *      register(deps: MyCommandDeps) {
 *        registerCommands({
 *          'my.action': async (args) => {
 *            await deps.myService?.(args?.value)
 *          }
 *        })
 *      },
 *
 *      unregister() {
 *        unregisterCommands(['my.action'])
 *      }
 *    }
 *    ```
 *
 * **Example for Self-Contained Command (no external dependencies):**
 *    ```typescript
 *    // commands/calculator-command.ts
 *    export const calculatorCommand: SlashCommandHandler = {
 *      name: 'calc',
 *      aliases: ['calculator'],
 *      description: 'Simple calculator',
 *
 *      async search(args: string) {
 *        if (!args.trim()) return []
 *        try {
 *          // Safe math evaluation (implement proper parser in real use)
 *          const result = Function('"use strict"; return (' + args + ')')()
 *          return [{
 *            id: 'calc-result',
 *            title: `${args} = ${result}`,
 *            description: 'Calculator result',
 *            type: 'command' as const,
 *            data: { command: 'calc.copy', args: { result: result.toString() } }
 *          }]
 *        } catch {
 *          return [{
 *            id: 'calc-error',
 *            title: 'Invalid expression',
 *            description: 'Please enter a valid math expression',
 *            type: 'command' as const,
 *            data: { command: 'calc.noop', args: {} }
 *          }]
 *        }
 *      },
 *
 *      register() {
 *        registerCommands({
 *          'calc.copy': (args) => navigator.clipboard.writeText(args.result),
 *          'calc.noop': () => {} // No operation
 *        })
 *      },
 *
 *      unregister() {
 *        unregisterCommands(['calc.copy', 'calc.noop'])
 *      }
 *    }
 *    ```
 *
 * 2. **Register Command** (in `./commands/slash.tsx`):
 *    ```typescript
 *    import { myCommand } from './my-command'
 *    import { calculatorCommand } from './calculator-command' // For self-contained commands
 *
 *    export const registerSlashCommands = (deps: Record<string, any>) => {
 *      slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
 *      slashCommandRegistry.register(languageCommand, { setLocale: deps.setLocale })
 *      slashCommandRegistry.register(myCommand, { myService: deps.myService }) // With dependencies
 *      slashCommandRegistry.register(calculatorCommand) // Self-contained, no dependencies
 *    }
 *
 *    export const unregisterSlashCommands = () => {
 *      slashCommandRegistry.unregister('theme')
 *      slashCommandRegistry.unregister('language')
 *      slashCommandRegistry.unregister('mycommand')
 *      slashCommandRegistry.unregister('calc') // Add this line
 *    }
 *    ```
 *
 *
 * 3. **Update SlashCommandProvider** (in `./commands/slash.tsx`):
 *    ```typescript
 *    export const SlashCommandProvider = () => {
 *      const theme = useTheme()
 *      const myService = useMyService() // Add external dependency if needed
 *
 *      useEffect(() => {
 *        registerSlashCommands({
 *          setTheme: theme.setTheme,          // Required for theme command
 *          setLocale: setLocaleOnClient,      // Required for language command
 *          myService: myService,              // Required for your custom command
 *          // Note: calculatorCommand doesn't need dependencies, so not listed here
 *        })
 *        return () => unregisterSlashCommands()
 *      }, [theme.setTheme, myService]) // Update dependency array for all dynamic deps
 *
 *      return null
 *    }
 *    ```
 *
 *    **Note:** Self-contained commands (like calculator) don't require dependencies but are
 *    still registered through the same system for consistent lifecycle management.
 *
 * 4. **Usage**: Users can now type `/mycommand` or `/mc` to use your command
 *
 * ## Command System Architecture
 * - Commands are registered via `SlashCommandRegistry`
 * - Each command is self-contained with its own dependencies
 * - Commands support aliases for easier access
 * - Command execution is handled by the command bus system
 * - All commands should be registered through `SlashCommandProvider` for consistent lifecycle management
 *
 * ## Command Types
 * **Commands with External Dependencies:**
 * - Require external services, APIs, or React hooks
 * - Must provide dependencies in `SlashCommandProvider`
 * - Example: theme commands (needs useTheme), API commands (needs service)
 *
 * **Self-Contained Commands:**
 * - Pure logic operations, no external dependencies
 * - Still recommended to register through `SlashCommandProvider` for consistency
 * - Example: calculator, text manipulation commands
 *
 * ## Available Actions
 * - `@app` - Search applications
 * - `@knowledge` / `@kb` - Search knowledge bases
 * - `@plugin` - Search plugins
 * - `@node` - Search workflow nodes (workflow pages only)
 * - `/` - Execute slash commands (theme, language, etc.)
 */

import type { ActionItem, SearchResult } from './types'
import { appAction } from './app'
import { slashAction } from './commands'
import { slashCommandRegistry } from './commands/registry'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { ragPipelineNodesAction } from './rag-pipeline-nodes'
import { workflowNodesAction } from './workflow-nodes'

// Create dynamic Actions based on context
export const createActions = (isWorkflowPage: boolean, isRagPipelinePage: boolean) => {
  const baseActions = {
    slash: slashAction,
    app: appAction,
    knowledge: knowledgeAction,
    plugin: pluginAction,
  }

  // Add appropriate node search based on context
  if (isRagPipelinePage) {
    return {
      ...baseActions,
      node: ragPipelineNodesAction,
    }
  }
  else if (isWorkflowPage) {
    return {
      ...baseActions,
      node: workflowNodesAction,
    }
  }

  // Default actions without node search
  return baseActions
}

// Legacy export for backward compatibility
export const Actions = {
  slash: slashAction,
  app: appAction,
  knowledge: knowledgeAction,
  plugin: pluginAction,
  node: workflowNodesAction,
}

export const searchAnything = async (
  locale: string,
  query: string,
  actionItem?: ActionItem,
  dynamicActions?: Record<string, ActionItem>,
): Promise<SearchResult[]> => {
  const trimmedQuery = query.trim()

  if (actionItem) {
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const prefixPattern = new RegExp(`^(${escapeRegExp(actionItem.key)}|${escapeRegExp(actionItem.shortcut)})\\s*`)
    const searchTerm = trimmedQuery.replace(prefixPattern, '').trim()
    try {
      return await actionItem.search(query, searchTerm, locale)
    }
    catch (error) {
      console.warn(`Search failed for ${actionItem.key}:`, error)
      return []
    }
  }

  if (trimmedQuery.startsWith('@') || trimmedQuery.startsWith('/'))
    return []

  const globalSearchActions = Object.values(dynamicActions || Actions)
    // Exclude slash commands from general search results
    .filter(action => action.key !== '/')

  // Use Promise.allSettled to handle partial failures gracefully
  const searchPromises = globalSearchActions.map(async (action) => {
    try {
      const results = await action.search(query, query, locale)
      return { success: true, data: results, actionType: action.key }
    }
    catch (error) {
      console.warn(`Search failed for ${action.key}:`, error)
      return { success: false, data: [], actionType: action.key, error }
    }
  })

  const settledResults = await Promise.allSettled(searchPromises)

  const allResults: SearchResult[] = []
  const failedActions: string[] = []

  settledResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      allResults.push(...result.value.data)
    }
    else {
      const actionKey = globalSearchActions[index]?.key || 'unknown'
      failedActions.push(actionKey)
    }
  })

  if (failedActions.length > 0)
    console.warn(`Some search actions failed: ${failedActions.join(', ')}`)

  return allResults
}

export const matchAction = (query: string, actions: Record<string, ActionItem>) => {
  return Object.values(actions).find((action) => {
    // Special handling for slash commands
    if (action.key === '/') {
      // Get all registered commands from the registry
      const allCommands = slashCommandRegistry.getAllCommands()

      // Check if query matches any registered command
      return allCommands.some((cmd) => {
        const cmdPattern = `/${cmd.name}`

        // For direct mode commands, don't match (keep in command selector)
        if (cmd.mode === 'direct')
          return false

        // For submenu mode commands, match when complete command is entered
        return query === cmdPattern || query.startsWith(`${cmdPattern} `)
      })
    }

    const reg = new RegExp(`^(${action.key}|${action.shortcut})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './commands'
export * from './types'
export { appAction, knowledgeAction, pluginAction, workflowNodesAction }
