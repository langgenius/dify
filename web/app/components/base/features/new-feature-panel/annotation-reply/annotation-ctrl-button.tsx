'use client'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiFileEditLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useModalContext } from '@/context/modal-context'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleClient, consoleQuery } from '@/service/console'

type AnnotationCtrlButtonProps = {
  appId: string
  messageId?: string
  query: string
  answer: string
  onAdded: (annotationId: string, authorName: string) => void
}
export default function AnnotationCtrlButton({
  query,
  answer,
  appId,
  messageId,
  onAdded,
}: AnnotationCtrlButtonProps) {
  const { t } = useTranslation(['appDebug', 'common'])
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.annotation_quota_limit,
    }),
  )
  const isAnnotationQuotaUnavailable =
    deploymentEdition === 'CLOUD' && annotationQuota === undefined
  // A limit of 0 means unlimited.
  const isAnnotationFull =
    deploymentEdition === 'CLOUD' &&
    annotationQuota !== undefined &&
    annotationQuota.limit > 0 &&
    annotationQuota.size >= annotationQuota.limit
  const { setShowAnnotationFullModal } = useModalContext()
  const handleAdd = async () => {
    if (isAnnotationQuotaUnavailable) return
    if (isAnnotationFull) {
      setShowAnnotationFullModal()
      return
    }
    const res = await consoleClient.apps.byAppId.annotations.post({
      params: { app_id: appId },
      body: { message_id: messageId, question: query, answer },
    })
    toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }) as string)
    // The create response does not include the author.
    onAdded(res.id, '')
  }
  return (
    <>
      {answer && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $['feature.annotation.add'], { ns: 'appDebug' })}
                disabled={isAnnotationQuotaUnavailable}
                onClick={handleAdd}
              >
                <RiFileEditLine aria-hidden className="size-4" />
              </IconButton>
            }
          />
          <TooltipContent>
            {t(($) => $['feature.annotation.add'], { ns: 'appDebug' })}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
