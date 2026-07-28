'use client'

import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeSettingsPath } from './routes'

function modelSetupReady(configurationState: KnowledgeFsSettingsResponse['configuration_state']) {
  return configurationState === 'active' || configurationState === 'pending-validation'
}

export function useKnowledgeModelSetupGuard(knowledgeSpaceId: string) {
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const [modelSetupDialogOpen, setModelSetupDialogOpen] = useState(false)
  const checkPromiseRef = useRef<Promise<boolean> | undefined>(undefined)
  const settingsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const refetchSettings = settingsQuery.refetch

  const ensureModelSetupReady = useCallback(() => {
    if (checkPromiseRef.current) return checkPromiseRef.current

    const checkPromise = refetchSettings({ cancelRefetch: false })
      .then((result) => {
        if (result.isError || !result.data) {
          toast.error(tCommon(($) => $['api.actionFailed']))
          return false
        }
        if (!modelSetupReady(result.data.configuration_state)) {
          setModelSetupDialogOpen(true)
          return false
        }
        return true
      })
      .catch(() => {
        toast.error(tCommon(($) => $['api.actionFailed']))
        return false
      })
      .finally(() => {
        checkPromiseRef.current = undefined
      })
    checkPromiseRef.current = checkPromise
    return checkPromise
  }, [refetchSettings, tCommon])

  const configureModelSetup = useCallback(() => {
    setModelSetupDialogOpen(false)
    router.push(newKnowledgeSettingsPath(knowledgeSpaceId))
  }, [knowledgeSpaceId, router])

  return {
    configureModelSetup,
    ensureModelSetupReady,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  }
}
