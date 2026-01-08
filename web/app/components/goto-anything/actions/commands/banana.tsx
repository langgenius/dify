import type { SlashCommandHandler } from './types'
import { RiSparklingFill } from '@remixicon/react'
import * as React from 'react'
import { isInWorkflowPage, VIBE_COMMAND_EVENT } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

type BananaDeps = Record<string, never>

const BANANA_PROMPT_EXAMPLE = 'Summarize a document, classify sentiment, then notify Slack'

const dispatchVibeCommand = (input?: string) => {
  if (typeof document === 'undefined')
    return

  document.dispatchEvent(new CustomEvent(VIBE_COMMAND_EVENT, { detail: { dsl: input } }))
}

export const bananaCommand: SlashCommandHandler<BananaDeps> = {
  name: 'banana',
  description: i18n.t('gotoAnything.actions.vibeDesc', { ns: 'app' }),
  mode: 'submenu',
  isAvailable: () => isInWorkflowPage(),

  async search(args: string, locale: string = 'en') {
    const trimmed = args.trim()
    const hasInput = !!trimmed

    return [{
      id: 'banana-vibe',
      title: i18n.t('gotoAnything.actions.vibeTitle', { ns: 'app', lng: locale }) || 'Banana',
      description: hasInput
        ? i18n.t('gotoAnything.actions.vibeDesc', { ns: 'app', lng: locale })
        : i18n.t('gotoAnything.actions.vibeHint', { ns: 'app', lng: locale, prompt: BANANA_PROMPT_EXAMPLE }),
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiSparklingFill className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: {
        command: 'workflow.vibe',
        args: { dsl: trimmed },
      },
    }]
  },

  register(_deps: BananaDeps) {
    registerCommands({
      'workflow.vibe': async (args) => {
        dispatchVibeCommand(args?.dsl)
      },
    })
  },

  unregister() {
    unregisterCommands(['workflow.vibe'])
  },
}
