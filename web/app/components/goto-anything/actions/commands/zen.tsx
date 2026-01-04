import type { SlashCommandHandler } from './types'
import { RiFullscreenLine } from '@remixicon/react'
import * as React from 'react'
import { isInWorkflowPage } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Zen command dependency types - no external dependencies needed
type ZenDeps = Record<string, never>

// Custom event name for zen toggle
export const ZEN_TOGGLE_EVENT = 'zen-toggle-maximize'

// Shared function to dispatch zen toggle event
const toggleZenMode = () => {
  window.dispatchEvent(new CustomEvent(ZEN_TOGGLE_EVENT))
}

/**
 * Zen command - Toggle canvas maximize (focus mode) in workflow pages
 * Only available in workflow and chatflow pages
 */
export const zenCommand: SlashCommandHandler<ZenDeps> = {
  name: 'zen',
  description: 'Toggle canvas focus mode',
  mode: 'direct',

  // Only available in workflow/chatflow pages
  isAvailable: () => isInWorkflowPage(),

  // Direct execution function
  execute: toggleZenMode,

  async search(_args: string, locale: string = 'en') {
    return [{
      id: 'zen',
      title: i18n.t('gotoAnything.actions.zenTitle', { ns: 'app', lng: locale }) || 'Zen Mode',
      description: i18n.t('gotoAnything.actions.zenDesc', { ns: 'app', lng: locale }) || 'Toggle canvas focus mode',
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiFullscreenLine className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: { command: 'workflow.zen', args: {} },
    }]
  },

  register(_deps: ZenDeps) {
    registerCommands({
      'workflow.zen': async () => toggleZenMode(),
    })
  },

  unregister() {
    unregisterCommands(['workflow.zen'])
  },
}
