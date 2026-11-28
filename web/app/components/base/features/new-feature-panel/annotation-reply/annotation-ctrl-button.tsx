'use client'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AnnotationFullContent from '@/app/components/billing/annotation-full/modal'
import { getCountQuota, isQuotaReached } from '@/app/components/billing/quota'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

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
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => getCountQuota(data.annotation_quota_limit),
    }),
  )
  const isAnnotationQuotaUnavailable = annotationQuota === undefined
  const isAnnotationFull = annotationQuota !== undefined && isQuotaReached(annotationQuota)
  // The mutation's cache policy refreshes the annotation list, its export and the quota.
  const creation = useMutation(consoleQuery.apps.byAppId.annotations.post.mutationOptions())
  if (!answer) return null

  const handleAdd = () => {
    creation.mutate(
      {
        params: { app_id: appId },
        body: { message_id: messageId, question: query, answer },
      },
      {
        onSuccess: (res) => {
          toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }) as string)
          // The create response does not include the author.
          onAdded(res.id, '')
        },
      },
    )
  }
  const label = t(($) => $['feature.annotation.add'], { ns: 'appDebug' })
  const button = (
    <IconButton
      aria-label={label}
      disabled={isAnnotationQuotaUnavailable}
      onClick={isAnnotationFull ? undefined : handleAdd}
    >
      <span aria-hidden className="i-ri-file-edit-line size-4" />
    </IconButton>
  )
  const action = (
    <Tooltip>
      <TooltipTrigger render={isAnnotationFull ? <DialogTrigger render={button} /> : button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
  return isAnnotationFull ? (
    <Dialog>
      {action}
      <AnnotationFullContent />
    </Dialog>
  ) : (
    action
  )
}
