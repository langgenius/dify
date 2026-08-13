'use client'
import type { FC } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiEditLine, RiFileEditLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { addAnnotation } from '@/service/annotation'

type Props = Readonly<{
  appId: string
  messageId?: string
  cached: boolean
  query: string
  answer: string
  onAdded: (annotationId: string, authorName: string) => void
  onEdit: () => void
}>
const AnnotationCtrlButton: FC<Props> = ({
  cached,
  query,
  answer,
  appId,
  messageId,
  onAdded,
  onEdit,
}) => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull =
    enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse
  const { setShowAnnotationFullModal } = useModalContext()
  const handleAdd = async () => {
    if (isAnnotationFull) {
      setShowAnnotationFullModal()
      return
    }
    const res = await addAnnotation(appId, {
      message_id: messageId,
      question: query,
      answer,
    })
    toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }) as string)
    onAdded(res.id, res.account?.name ?? '')
  }
  return (
    <>
      {cached && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}
                onClick={onEdit}
              >
                <RiEditLine aria-hidden className="size-4" />
              </IconButton>
            }
          />
          <TooltipContent>
            {t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}
          </TooltipContent>
        </Tooltip>
      )}
      {!cached && answer && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $['feature.annotation.add'], { ns: 'appDebug' })}
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
export default React.memo(AnnotationCtrlButton)
