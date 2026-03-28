'use client'
import type { FC } from 'react'
import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import Modal from '@/app/components/base/modal'
import { cn } from '@/utils/classnames'
import ResultItemFooter from './result-item-footer'
import ResultItemMeta from './result-item-meta'

const i18nPrefix = ''
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
    <div className={cn('cursor-pointer rounded-xl bg-chat-bubble-bg pt-3 hover:shadow-lg')} onClick={showDetailModal}>
      {/* Meta info */}
      <ResultItemMeta className="px-3" labelPrefix="Chunk" positionId={positionId} wordCount={content.length} score={score} />

      {/* Main */}
      <div className="mt-1 px-3">
        <div className="body-md-regular line-clamp-2 break-all text-text-primary">{content}</div>
      </div>

      {/* Foot */}
      <ResultItemFooter docType={FileAppearanceTypeEnum.custom} docTitle={title} showDetailModal={showDetailModal} />

      {isShowDetailModal && (
        <Modal
          title={t(`${i18nPrefix}chunkDetail`, { ns: 'datasetHitTesting' })}
          className="!min-w-[800px]"
          closable
          onClose={hideDetailModal}
          isShow={isShowDetailModal}
        >
          <div className="mt-4 flex-1">
            <ResultItemMeta labelPrefix="Chunk" positionId={positionId} wordCount={content.length} score={score} />
            <div className={cn('body-md-regular mt-2 break-all text-text-secondary', 'h-[min(539px,_80vh)] overflow-y-auto')}>
              {content}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default React.memo(ResultItemExternal)
