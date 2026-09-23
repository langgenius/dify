'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/console'
import { AgentConfigurePageLoading } from './page-loading'

export function AgentConfigureComposerProvider({
  children,
  initialConfig,
  initializeDefaultModel,
}: {
  children: ReactNode
  initialConfig?: AgentSoulConfig
  initializeDefaultModel: boolean
}) {
  const { t } = useTranslation('agentV2')
  const [session, setSession] = useState<{
    draft: AgentSoulConfigFormState
    savedDraft: AgentSoulConfigFormState
  }>()
  const savedDraft = agentSoulConfigToFormState(initialConfig)
  const needsDefaultModel = initializeDefaultModel && !savedDraft.model
  const defaultModelQuery = useQuery(
    consoleQuery.workspaces.current.defaultModel.get.queryOptions({
      input: { query: { model_type: 'llm' } },
      enabled: !session && needsDefaultModel,
    }),
  )

  if (!session) {
    if (needsDefaultModel && defaultModelQuery.isPending) {
      return <AgentConfigurePageLoading label={t(($) => $['agentDetail.sections.configure'])} />
    }

    const defaultModel = defaultModelQuery.data?.data
    // Capture defaults once for this keyed form session. Later query responses must not reset edits.
    setSession({
      savedDraft,
      draft:
        needsDefaultModel && defaultModel
          ? {
              ...savedDraft,
              model: {
                provider: defaultModel.provider.provider,
                model: defaultModel.model,
              },
            }
          : savedDraft,
    })
    return null
  }

  return (
    <AgentComposerProvider initialDraft={session.draft} initialSavedDraft={session.savedDraft}>
      {children}
    </AgentComposerProvider>
  )
}
