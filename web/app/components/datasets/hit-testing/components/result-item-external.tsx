'use client'
import type { FC } from 'react'
import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import ResultItemFooter from './result-item-footer'
import ResultItemMeta from './result-item-meta'

const i18nPrefix = ''
type Props = {
  readonly payload: ExternalKnowledgeBaseHitTesting
  readonly positionId: number
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
        <div className="line-clamp-2 body-md-regular break-all text-text-primary">{content}</div>
      </div>

      {/* Foot */}
      <ResultItemFooter docType={FileAppearanceTypeEnum.custom} docTitle={title} showDetailModal={showDetailModal} />

      {isShowDetailModal && (
        <Dialog
          open={isShowDetailModal}
          onOpenChange={(open) => {
            if (!open)
              hideDetailModal()
          }}
        >
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full min-w-[800px]! flex-col overflow-hidden! border-none text-left align-middle">
            <DialogCloseButton />
            <DialogTitle className="shrink-0 title-2xl-semi-bold text-text-primary">
              {t($ => $[`${i18nPrefix}chunkDetail`], { ns: 'datasetHitTesting' })}
            </DialogTitle>

            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <ResultItemMeta labelPrefix="Chunk" positionId={positionId} wordCount={content.length} score={score} />
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto body-md-regular break-all text-text-secondary">
                {content}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

export default React.memo(ResultItemExternal)
