import type { SlashCommandHandler } from './types'
import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { RiChat3Line, RiNodeTree } from '@remixicon/react'
import * as React from 'react'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { registerCommands, unregisterCommands } from './command-bus'

type CreateOption = {
  id: string
  label: string
  description: string
  mode: WorkflowGeneratorMode
  icon: React.ComponentType<{ className?: string }>
}

const OPTIONS: CreateOption[] = [
  {
    id: 'workflow',
    label: 'Workflow',
    description: 'AI-generated workflow app',
    mode: 'workflow',
    icon: RiNodeTree,
  },
  {
    id: 'chatflow',
    label: 'Chatflow',
    description: 'AI-generated chatflow (advanced chat) app',
    mode: 'advanced-chat',
    icon: RiChat3Line,
  },
]

/**
 * `/create` command — generate a new Workflow or Chatflow app from a natural-
 * language description. See ``components/workflow/workflow-generator/``.
 */
export const createCommand: SlashCommandHandler = {
  name: 'create',
  aliases: ['new', 'generate'],
  description: 'Create an AI-generated workflow',
  mode: 'submenu',

  async search(args: string) {
    const query = args.trim().toLowerCase()
    const filtered = OPTIONS.filter(
      opt => !query || opt.id.includes(query) || opt.label.toLowerCase().includes(query),
    )
    return filtered.map(opt => ({
      id: `create-${opt.id}`,
      title: opt.label,
      description: opt.description,
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <opt.icon className="size-4 text-text-tertiary" />
        </div>
      ),
      data: { command: 'create.open', args: { mode: opt.mode } },
    }))
  },

  register() {
    registerCommands({
      'create.open': async (args) => {
        const mode: WorkflowGeneratorMode = (args?.mode ?? 'workflow') as WorkflowGeneratorMode
        // Detect Studio context: /app/<appId>/workflow.
        let currentAppId: string | null = null
        let currentAppMode: WorkflowGeneratorMode | null = null
        if (typeof window !== 'undefined') {
          const match = window.location.pathname.match(/^\/app\/([^/]+)\/workflow/)
          if (match) {
            currentAppId = match[1] ?? null
            // The /workflow path covers both Workflow and Advanced-Chat apps,
            // so we don't know the mode for sure from the URL alone. We pass
            // the requested mode as the "current" mode — the modal compares
            // them and only enables "Apply to current draft" when they match.
            currentAppMode = mode
          }
        }
        useWorkflowGeneratorStore.getState().openGenerator({
          mode,
          currentAppId,
          currentAppMode,
        })
      },
    })
  },

  unregister() {
    unregisterCommands(['create.open'])
  },
}
