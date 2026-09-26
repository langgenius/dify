import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { SlashCommandHandler } from './types'
import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { getI18n } from 'react-i18next'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { AppModeEnum } from '@/types/app'
import { registerCommands, unregisterCommands } from './command-bus'

/**
 * `/refine` command — refine the CURRENT Workflow / Chatflow draft graph from
 * a natural-language change description. Only available inside a graph-based
 * Studio; the mode is taken from the open app (no submenu to pick), and the
 * result always applies back to the current draft.
 */
export const createRefineCommand = (
  currentApp: Pick<AppDetailWithSite, 'id' | 'mode'> | undefined,
): SlashCommandHandler => {
  const mode: WorkflowGeneratorMode | null =
    currentApp?.mode === AppModeEnum.WORKFLOW
      ? 'workflow'
      : currentApp?.mode === AppModeEnum.ADVANCED_CHAT
        ? 'advanced-chat'
        : null

  const openRefineGenerator = () => {
    if (!currentApp || !mode) return
    useWorkflowGeneratorStore.getState().openGenerator({
      intent: 'refine',
      mode,
      currentAppId: currentApp.id,
      currentAppMode: mode,
    })
  }

  return {
    name: 'refine',
    aliases: ['improve'],
    description: getI18n().t(($) => $['gotoAnything.actions.refineCategoryDesc'], { ns: 'app' }),
    mode: 'direct',

    // Only surface inside a Workflow / Advanced-Chat Studio — elsewhere there's
    // no draft graph to refine.
    isAvailable: () => mode !== null,

    execute: openRefineGenerator,

    search(_args: string, locale?: string) {
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
              <span aria-hidden className="i-ri-sparkling-2-line size-4 text-text-tertiary" />
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
}
