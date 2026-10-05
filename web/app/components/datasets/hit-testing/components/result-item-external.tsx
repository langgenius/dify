'use client'
import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { ResultItemFooter } from './result-item-footer'
import { ResultItemMeta } from './result-item-meta'

type ResultItemExternalProps = {
  payload: ExternalKnowledgeBaseHitTesting
  positionId: number
}

export const ResultItemExternal = memo(({ payload, positionId }: ResultItemExternalProps) => {
  const { t } = useTranslation(['common', 'datasetHitTesting'])
  const descriptionId = useId()
  const { content, title, score } = payload

  return (
    <Dialog>
      <DialogTrigger
        aria-label={`${t(($) => $.open, { ns: 'datasetHitTesting' })} ${title}`}
        aria-describedby={descriptionId}
        className="block w-full cursor-pointer rounded-xl bg-chat-bubble-bg pt-3 text-left hover:shadow-lg focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      >
        <span id={descriptionId} className="block">
          <ResultItemMeta
            className="px-3"
            labelPrefix="Chunk"
            positionId={positionId}
            wordCount={content.length}
            score={score}
          />
          <span className="mt-1 block px-3">
            <span className="line-clamp-2 body-md-regular break-all text-text-primary">
              {content}
            </span>
          </span>
        </span>
        <ResultItemFooter docType={FileAppearanceTypeEnum.custom} docTitle={title} />
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col overflow-hidden! border-none text-left align-middle">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <DialogTitle className="shrink-0 title-2xl-semi-bold text-text-primary">
          {t(($) => $.chunkDetail, { ns: 'datasetHitTesting' })}
        </DialogTitle>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <ResultItemMeta
            labelPrefix="Chunk"
            positionId={positionId}
            wordCount={content.length}
            score={score}
          />
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto body-md-regular break-all text-text-secondary">
            {content}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})
