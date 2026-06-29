import type { SlashCommandHandler } from './types'
import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { RiChat3Line, RiNodeTree } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { AppModeEnum } from '@/types/app'
import { registerCommands, unregisterCommands } from './command-bus'

type CreateOption = {
  id: string
  /** i18n key (ns: 'app') for the option's display label. */
  titleKey: string
  /** i18n key (ns: 'app') for the option's one-line description. */
  descKey: string
  mode: WorkflowGeneratorMode
  icon: React.ComponentType<{ className?: string }>
}

// `as const` keeps titleKey/descKey as literal types so the typed `i18n.t`
// accepts them as known keys; `satisfies` still validates the shape.
const OPTIONS = [
  {
    id: 'workflow',
    titleKey: 'gotoAnything.actions.createWorkflow',
    descKey: 'gotoAnything.actions.createWorkflowDesc',
    mode: 'workflow',
    icon: RiNodeTree,
  },
  {
    id: 'chatflow',
    titleKey: 'gotoAnything.actions.createChatflow',
    descKey: 'gotoAnything.actions.createChatflowDesc',
    mode: 'advanced-chat',
    icon: RiChat3Line,
  },
] as const satisfies readonly CreateOption[]

/**
 * `/create` command — generate a Workflow or Chatflow app from a
 * natural-language description.
 *
 * The user-picked mode is passed through to the generator modal explicitly
 * rather than sniffed from the URL, which avoids the mode-mismatch dead-end
 * the URL-sniffing approach used to produce.
 *
 * When triggered from inside a graph-based Studio (Workflow / Advanced-Chat)
 * whose app mode matches the picked mode, it threads the current app (id +
 * mode) through so the modal offers "Apply to current draft" — this is the
 * in-Studio create-and-apply journey that replaced the old toolbar button.
 * With no Studio app open, or when the picked mode differs from the open
 * app's mode, it falls back to new-app creation only.
 */
export const createCommand: SlashCommandHandler = {
  name: 'create',
  aliases: ['new', 'generate'],
  // Fallback only — the palette localises the root row via the slashKeyMap in
  // command-selector.tsx (gotoAnything.actions.createCategoryDesc).
  description: 'Create an AI-generated workflow or chatflow',
  mode: 'submenu',

  async search(args: string, locale?: string) {
    const i18n = getI18n()
    const tr = (key: (typeof OPTIONS)[number]['titleKey' | 'descKey']) =>
      i18n.t(key, { ns: 'app', lng: locale })
    const query = args.trim().toLowerCase()
    const filtered = OPTIONS.filter(
      opt => !query || opt.id.includes(query) || tr(opt.titleKey).toLowerCase().includes(query),
    )
    return filtered.map(opt => ({
      id: `create-${opt.id}`,
      title: tr(opt.titleKey),
      description: tr(opt.descKey),
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

        // If a graph-based Studio app is open and its mode matches the picked
        // mode, thread it through so the modal can offer "Apply to current
        // draft". A mode mismatch (or no app open) falls back to new-app only,
        // mirroring the precondition the modal uses for canApplyToCurrent.
        const appDetail = useAppStore.getState().appDetail
        const currentAppMode: WorkflowGeneratorMode | null
          = appDetail?.mode === AppModeEnum.WORKFLOW
            ? 'workflow'
            : appDetail?.mode === AppModeEnum.ADVANCED_CHAT
              ? 'advanced-chat'
              : null

        if (appDetail && currentAppMode === mode) {
          useWorkflowGeneratorStore.getState().openGenerator({
            mode,
            currentAppId: appDetail.id,
            currentAppMode,
          })
          return
        }

        useWorkflowGeneratorStore.getState().openGenerator({ mode })
      },
    })
  },

  unregister() {
    unregisterCommands(['create.open'])
  },
}
