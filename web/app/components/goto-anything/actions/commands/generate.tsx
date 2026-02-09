import type { SlashCommandHandler } from './types'
import { RiSparklingFill } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { isInWorkflowPage, VIBE_COMMAND_EVENT } from '@/app/components/workflow/constants'
import { registerCommands, unregisterCommands } from './command-bus'

type GenerateDeps = Record<string, never>

const GENERATE_PROMPT_EXAMPLE = 'Summarize a document, classify sentiment, then notify Slack'

const dispatchGenerateCommand = (input?: string) => {
  if (typeof document === 'undefined')
    return

  document.dispatchEvent(new CustomEvent(VIBE_COMMAND_EVENT, { detail: { dsl: input } }))
}

export const generateCommand: SlashCommandHandler<GenerateDeps> = {
  name: 'generate',
  description: getI18n().t('gotoAnything.actions.generationDesc', { ns: 'app' }),
  mode: 'submenu',
  isAvailable: () => isInWorkflowPage(),

  async search(args: string, locale: string = 'en') {
    const trimmed = args.trim()
    const hasInput = !!trimmed

    return [{
      id: 'generate',
      title: getI18n().t('gotoAnything.actions.vibeTitle', { ns: 'app', lng: locale }) || 'Generate',
      description: hasInput
        ? getI18n().t('gotoAnything.actions.generationDesc', { ns: 'app', lng: locale })
        : getI18n().t('gotoAnything.actions.vibeHint', { ns: 'app', lng: locale, prompt: GENERATE_PROMPT_EXAMPLE }),
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiSparklingFill className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: {
        command: 'workflow.generate',
        args: { dsl: trimmed },
      },
    }]
  },

  register(_deps: GenerateDeps) {
    registerCommands({
      'workflow.generate': async (args) => {
        dispatchGenerateCommand(args?.dsl)
      },
    })
  },

  unregister() {
    unregisterCommands(['workflow.generate'])
  },
}
