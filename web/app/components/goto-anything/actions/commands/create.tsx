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
 * `/create` command — generate a brand-new Workflow or Chatflow app from a
 * natural-language description.
 *
 * This command is scoped to NEW-app creation only. Refining the current
 * Studio draft is handled by the toolbar button in
 * ``components/workflow-app/components/workflow-header/generate-trigger.tsx``,
 * which opens the same modal with the app's real mode locked + currentAppId
 * set. Keeping the two journeys separate avoids the mode-mismatch dead-end
 * the URL-sniffing approach used to produce when /create was triggered from
 * a Workflow Studio page with the "wrong" mode picked.
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
        // No currentAppId / currentAppMode — /create is new-app only.
        useWorkflowGeneratorStore.getState().openGenerator({ mode })
      },
    })
  },

  unregister() {
    unregisterCommands(['create.open'])
  },
}
