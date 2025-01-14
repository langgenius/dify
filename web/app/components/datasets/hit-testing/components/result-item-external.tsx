'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import ResultItemMeta from './result-item-meta'
import ResultItemFooter from './result-item-footer'
import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

const i18nPrefix = 'datasetHitTesting'
type Props = {
  payload: ExternalKnowledgeBaseHitTesting
  positionId: number
}

const ResultItemExternal: FC<Props> = ({ payload, positionId }) => {
  const { t } = useTranslation()
  const { content, title, score } = payload
  const [
    isShowDetailModal,
    { setTrue: showDetailModal, setFalse: hideDetailModal },
  ] = useBoolean(false)

  return (
    <div className={cn('pt-3 bg-chat-bubble-bg rounded-xl hover:shadow-lg cursor-pointer')} onClick={showDetailModal}>
      {/* Meta info */}
      <ResultItemMeta className='px-3' labelPrefix={'Chunk'} positionId={positionId} wordCount={content.length} score={score} />

      {/* Main */}
      <div className='mt-1 px-3'>
        <div className='line-clamp-2 body-md-regular break-all'>{content}</div>
      </div>

      {/* Foot */}
      <ResultItemFooter docType={FileAppearanceTypeEnum.custom} docTitle={title} showDetailModal={showDetailModal} />

      {isShowDetailModal && (
        <Modal
          title={t(`${i18nPrefix}.chunkDetail`)}
          className={'!min-w-[800px]'}
          closable
          onClose={hideDetailModal}
          isShow={isShowDetailModal}
        >
          <div className='mt-4 flex-1'>
            <ResultItemMeta labelPrefix={'Chunk'} positionId={positionId} wordCount={content.length} score={score} />
            <div className={cn('mt-2 body-md-regular text-text-secondary break-all', 'h-[min(539px,_80vh)] overflow-y-auto')}>
              {content}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default React.memo(ResultItemExternal)
