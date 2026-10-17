'use client'
import type { ExternalHitTestingRecordResponse } from '@dify/contracts/api/console/datasets/types.gen'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { ResultItemFooter } from './result-item-footer'
import { ResultItemMeta } from './result-item-meta'

type ResultItemExternalProps = {
  payload: ExternalHitTestingRecordResponse
  positionId: number
}

export const ResultItemExternal = memo(({ payload, positionId }: ResultItemExternalProps) => {
  const { t } = useTranslation(['common', 'datasetHitTesting'])
  const descriptionId = useId()
  const content = payload.content ?? ''
  const title = payload.title ?? ''
  const score = payload.score ?? null

  return (
    <Dialog>
      <DialogTrigger
        aria-label={`${t(($) => $.open, { ns: 'datasetHitTesting' })} ${title}`}
        aria-describedby={descriptionId}
        className="block w-full cursor-pointer rounded-xl bg-chat-bubble-bg pt-3 text-left hover:shadow-lg"
      >
        <span id={descriptionId} className="block">
          <ResultItemMeta
            className="px-3"
            labelPrefix="Chunk"
            positionId={positionId}
            wordCount={content.length}
            score={score}
          />
        </span>
        <span className="mt-1 block px-3">
          <span className="line-clamp-2 body-md-regular break-all text-text-primary">
            {content}
          </span>
        </span>
        <ResultItemFooter docType={FileAppearanceTypeEnum.custom} docTitle={title} />
      </DialogTrigger>
      <DialogContent className="w-full">
        <DialogHeader>
          <DialogTitle>{t(($) => $.chunkDetail, { ns: 'datasetHitTesting' })}</DialogTitle>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <ResultItemMeta
            labelPrefix="Chunk"
            positionId={positionId}
            wordCount={content.length}
            score={score}
          />
          <div className="mt-2 body-md-regular break-all text-text-secondary">{content}</div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
})
