import type { SlashCommandHandler } from './types'
import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { RiSparkling2Line } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { AppModeEnum } from '@/types/app'
import { registerCommands, unregisterCommands } from './command-bus'

/**
 * Map the open app's mode to a generator mode, or null when the current app
 * isn't a graph-based Studio (Chat / Agent / Completion have no canvas to
 * refine). This is the single source of truth for both the availability gate
 * and the mode we open the generator with.
 */
const currentStudioMode = (): WorkflowGeneratorMode | null => {
  const appMode = useAppStore.getState().appDetail?.mode
  if (appMode === AppModeEnum.WORKFLOW) return 'workflow'
  if (appMode === AppModeEnum.ADVANCED_CHAT) return 'advanced-chat'
  return null
}

/**
 * Open the generator in `refine` intent for the current Studio. The modal
 * fetches the current draft graph and sends it as context so the LLM amends
 * what's on the canvas instead of starting from scratch. No-op when there's
 * no graph-based app open (the command is gated by `isAvailable`, but the
 * guard keeps a stray command-bus call safe).
 */
const openRefineGenerator = () => {
  const appDetail = useAppStore.getState().appDetail
  const mode = currentStudioMode()
  if (!appDetail || !mode) return
  useWorkflowGeneratorStore.getState().openGenerator({
    intent: 'refine',
    mode,
    currentAppId: appDetail.id,
    currentAppMode: mode,
  })
}

/**
 * `/refine` command — refine the CURRENT Workflow / Chatflow draft graph from
 * a natural-language change description. Only available inside a graph-based
 * Studio; the mode is taken from the open app (no submenu to pick), and the
 * result always applies back to the current draft.
 */
export const refineCommand: SlashCommandHandler = {
  name: 'refine',
  aliases: ['improve'],
  // Fallback only — the palette localises the root row via the slashKeyMap in
  // command-selector.tsx (gotoAnything.actions.refineCategoryDesc).
  description: getI18n().t(($) => $['gotoAnything.actions.refineCategoryDesc'], { ns: 'app' }),
  mode: 'direct',

  // Only surface inside a Workflow / Advanced-Chat Studio — elsewhere there's
  // no draft graph to refine.
  isAvailable: () => currentStudioMode() !== null,

  execute: openRefineGenerator,

  async search(_args: string, locale?: string) {
    const i18n = getI18n()
    return [
      {
        id: 'refine-current',
        title: i18n.t(($) => $['gotoAnything.actions.refineTitle'], { ns: 'app', lng: locale }),
        description: i18n.t(($) => $['gotoAnything.actions.refineDesc'], {
          ns: 'app',
          lng: locale,
        }),
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <RiSparkling2Line className="size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'refine.open', args: {} },
      },
    ]
  },

  register() {
    registerCommands({
      'refine.open': async () => openRefineGenerator(),
    })
  },

  unregister() {
    unregisterCommands(['refine.open'])
  },
}
