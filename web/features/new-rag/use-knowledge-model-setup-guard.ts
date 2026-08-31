'use client'

import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { KnowledgeModelCapability } from './routes'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeSettingsReturnPath } from './routes'

export type KnowledgeModelReadinessGuardResult =
  | { status: 'ready'; readiness: KnowledgeFsSettingsResponse }
  | { status: 'blocked'; readiness: KnowledgeFsSettingsResponse }
  | { status: 'unavailable' }

type KnowledgeModelIntent = 'reindex' | 'retrieval-test' | 'source-sync' | 'upload'

export function useKnowledgeModelSetupGuard(knowledgeSpaceId: string) {
  const { t: tCommon } = useTranslation('common')
  const pathname = usePathname()
  const router = useRouter()
  const [modelSetupDialogOpen, setModelSetupDialogOpen] = useState(false)
  const [modelReadiness, setModelReadiness] = useState<KnowledgeFsSettingsResponse>()
  const blockedCapabilityRef = useRef<KnowledgeModelCapability | undefined>(undefined)
  const checkPromiseRef = useRef<Promise<KnowledgeFsSettingsResponse> | undefined>(undefined)
  const settingsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const refetchSettings = settingsQuery.refetch

  const ensureModelReady = useCallback(
    ({ capability }: { capability: KnowledgeModelCapability; intent?: KnowledgeModelIntent }) => {
      if (!checkPromiseRef.current) {
        checkPromiseRef.current = refetchSettings({ cancelRefetch: false })
          .then((result) => {
            if (result.isError || !result.data)
              throw result.error ?? new Error('Readiness unavailable')
            return result.data
          })
          .finally(() => {
            checkPromiseRef.current = undefined
          })
      }

      return checkPromiseRef.current
        .then<KnowledgeModelReadinessGuardResult>((readiness) => {
          if (readiness.capabilities[capability]) return { readiness, status: 'ready' }
          blockedCapabilityRef.current = capability
          setModelReadiness(readiness)
          setModelSetupDialogOpen(true)
          return { readiness, status: 'blocked' }
        })
        .catch(() => {
          toast.error(tCommon(($) => $['api.actionFailed']))
          return { status: 'unavailable' } as const
        })
    },
    [refetchSettings, tCommon],
  )

  const configureModelSetup = useCallback(() => {
    setModelSetupDialogOpen(false)
    const returnTo = `${pathname}${window.location.search}`
    router.push(
      newKnowledgeSettingsReturnPath(knowledgeSpaceId, {
        capability: blockedCapabilityRef.current,
        returnTo,
      }),
    )
  }, [knowledgeSpaceId, pathname, router])

  return {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  }
}

export type EnsureKnowledgeModelReady = ReturnType<
  typeof useKnowledgeModelSetupGuard
>['ensureModelReady']
