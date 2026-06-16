'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useCallback, useState } from 'react'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import {
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'

type AgentConfigurePublishPayload = {
  agent_id: string
  config_snapshot: AgentSoulConfig
}

export function useAgentConfigureSync({
  agentId,
}: {
  agentId: string
}) {
  const queryClient = useQueryClient()
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const [isPublishing, setIsPublishing] = useState(false)

  const saveComposerMutation = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions({
      onSuccess: (composerState, variables) => {
        queryClient.setQueryData(
          consoleQuery.agent.byAgentId.composer.get.queryKey({ input: { params: variables.params } }),
          composerState,
        )
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
        })
      },
    }),
  )

  const saveComposer = useSerialAsyncCallback(async (
    configSnapshot: AgentSoulConfig,
  ) => {
    const composerState = await saveComposerMutation.mutateAsync({
      params: {
        agent_id: agentId,
      },
      body: {
        variant: 'agent_app',
        save_strategy: 'save_as_new_version',
        agent_soul: configSnapshot,
      },
    })

    setOriginalConfig(composerState.agent_soul)
    setOriginalDraft(agentSoulConfigToFormState(composerState.agent_soul))
  })

  const publishDraft = useCallback(async (payload: AgentConfigurePublishPayload) => {
    setIsPublishing(true)
    try {
      await saveComposer(payload.config_snapshot)
    }
    catch {
      // Draft sync follows workflow autosave behavior: save failures are silent and keep the local draft intact.
    }
    finally {
      setIsPublishing(false)
    }
  }, [saveComposer])

  return {
    isPublishing,
    publishDraft,
  }
}
