import type { ActionItem } from './types'
import { RiSparklingFill } from '@remixicon/react'
import * as React from 'react'
import { isInWorkflowPage } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'

const BANANA_PROMPT_EXAMPLE = 'Summarize a document, classify sentiment, then notify Slack'

export const bananaAction: ActionItem = {
  key: '@banana',
  shortcut: '@banana',
  title: i18n.t('app.gotoAnything.actions.vibeTitle'),
  description: i18n.t('app.gotoAnything.actions.vibeDesc'),
  search: async (_query, searchTerm = '', locale) => {
    if (!isInWorkflowPage())
      return []

    const trimmed = searchTerm.trim()
    const hasInput = !!trimmed

    return [{
      id: 'banana-vibe',
      title: i18n.t('app.gotoAnything.actions.vibeTitle', { lng: locale }) || 'Banana',
      description: hasInput
        ? i18n.t('app.gotoAnything.actions.vibeDesc', { lng: locale })
        : i18n.t('app.gotoAnything.actions.vibeHint', { lng: locale, prompt: BANANA_PROMPT_EXAMPLE }),
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
}
