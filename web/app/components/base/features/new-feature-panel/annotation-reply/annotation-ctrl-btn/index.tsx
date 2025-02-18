'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import { useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { MessageCheckRemove, MessageFastPlus } from '@/app/components/base/icons/src/vender/line/communication'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import { Edit04 } from '@/app/components/base/icons/src/vender/line/general'
import RemoveAnnotationConfirmModal from '@/app/components/app/annotation/remove-annotation-confirm-modal'
import Tooltip from '@/app/components/base/tooltip'
import { addAnnotation, delAnnotation } from '@/service/annotation'
import Toast from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'

type Props = {
  appId: string
  messageId?: string
  annotationId?: string
  className?: string
  cached: boolean
  query: string
  answer: string
  onAdded: (annotationId: string, authorName: string) => void
  onEdit: () => void
  onRemoved: () => void
}

const CacheCtrlBtn: FC<Props> = ({
  className,
  cached,
  query,
  answer,
  appId,
  messageId,
  annotationId,
  onAdded,
  onEdit,
  onRemoved,
}) => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const { setShowAnnotationFullModal } = useModalContext()
  const [showModal, setShowModal] = useState(false)
  const cachedBtnRef = useRef<HTMLDivElement>(null)
  const isCachedBtnHovering = useHover(cachedBtnRef)
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

  const handleRemove = async () => {
    await delAnnotation(appId, annotationId!)
    Toast.notify({
      message: t('common.api.actionSuccess') as string,
      type: 'success',
    })
    onRemoved()
    setShowModal(false)
  }
  return (
    <div className={cn('inline-block', className)}>
      <div className='inline-flex cursor-pointer space-x-0.5 rounded-lg border border-gray-100 bg-white p-0.5 text-gray-500 shadow-md'>
        {cached
          ? (
            <div>
              <div
                ref={cachedBtnRef}
                className={cn(isCachedBtnHovering ? 'bg-[#FEF3F2] text-[#D92D20]' : 'bg-[#EEF4FF] text-[#444CE7]', 'flex items-center space-x-1 rounded-md p-1 text-xs font-medium leading-4')}
                onClick={() => setShowModal(true)}
              >
                {!isCachedBtnHovering
                  ? (
                    <>
                      <MessageFast className='h-4 w-4' />
                      <div>{t('appDebug.feature.annotation.cached')}</div>
                    </>
                  )
                  : <>
                    <MessageCheckRemove className='h-4 w-4' />
                    <div>{t('appDebug.feature.annotation.remove')}</div>
                  </>}
              </div>
            </div>
          )
          : answer
            ? (
              <Tooltip
                popupContent={t('appDebug.feature.annotation.add')}
              >
                <div
                  className='cursor-pointer rounded-md p-1 hover:bg-[#EEF4FF] hover:text-[#444CE7]'
                  onClick={handleAdd}
                >
                  <MessageFastPlus className='h-4 w-4' />
                </div>
              </Tooltip>
            )
            : null
        }
        <Tooltip
          popupContent={t('appDebug.feature.annotation.edit')}
        >
          <div
            className='cursor-pointer rounded-md p-1 hover:bg-black/5'
            onClick={onEdit}
          >
            <Edit04 className='h-4 w-4' />
          </div>
        </Tooltip>

      </div>
      <RemoveAnnotationConfirmModal
        isShow={showModal}
        onHide={() => setShowModal(false)}
        onRemove={handleRemove}
      />
    </div>
  )
}
export default React.memo(CacheCtrlBtn)
