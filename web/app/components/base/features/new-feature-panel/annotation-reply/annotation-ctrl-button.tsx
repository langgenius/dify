'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEditLine,
  RiFileEditLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import { addAnnotation } from '@/service/annotation'
import Toast from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'

type Props = {
  appId: string
  messageId?: string
  cached: boolean
  query: string
  answer: string
  onAdded: (annotationId: string, authorName: string) => void
  onEdit: () => void
}

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
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const { setShowAnnotationFullModal } = useModalContext()
  const handleAdd = async () => {
    if (isAnnotationFull) {
      setShowAnnotationFullModal()
      return
    }
    const res: any = await addAnnotation(appId, {
      message_id: messageId,
      question: query,
      answer,
    })
    Toast.notify({
      message: t('common.api.actionSuccess') as string,
      type: 'success',
    })
    onAdded(res.id, res.account?.name)
  }

  return (
    <>
      {cached && (
        <Tooltip
          popupContent={t('appDebug.feature.annotation.edit')}
        >
          <ActionButton onClick={onEdit}>
            <RiEditLine className='h-4 w-4' />
          </ActionButton>
        </Tooltip>
      )}
      {!cached && answer && (
        <Tooltip
          popupContent={t('appDebug.feature.annotation.add')}
        >
          <ActionButton onClick={handleAdd}>
            <RiFileEditLine className='h-4 w-4' />
          </ActionButton>
        </Tooltip>
      )}
    </>
  )
}
export default React.memo(AnnotationCtrlButton)
