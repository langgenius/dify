import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { QAChunk } from './types'
import { QAItemType } from './types'
import { PreviewSlice } from '@/app/components/datasets/formatted-text/flavours/preview-slice'
import SegmentIndexTag from '@/app/components/datasets/documents/detail/completed/common/segment-index-tag'
import Dot from '@/app/components/datasets/documents/detail/completed/common/dot'
import { formatNumber } from '@/utils/format'
import QAItem from './q-a-item'
import { ChunkingMode, type ParentMode } from '@/models/datasets'

type ChunkCardProps = {
  chunkType: ChunkingMode
  parentMode?: ParentMode
  content: string | string[] | QAChunk
  positionId?: string | number
  wordCount: number
}

const ChunkCard = (props: ChunkCardProps) => {
  const { chunkType, parentMode, content, positionId, wordCount } = props
  const { t } = useTranslation()

  const isFullDoc = useMemo(() => {
    return chunkType === ChunkingMode.parentChild && parentMode === 'full-doc'
  }, [chunkType, parentMode])

  const isParagraph = useMemo(() => {
    return chunkType === ChunkingMode.parentChild && parentMode === 'paragraph'
  }, [chunkType, parentMode])

  const contentElement = useMemo(() => {
    if (chunkType === ChunkingMode.parentChild) {
      return (content as string[]).map((child, index) => {
        const indexForLabel = index + 1
        return (
          <PreviewSlice
            key={child}
            label={`C-${indexForLabel}`}
            text={child}
            tooltip={`Child-chunk-${indexForLabel} · ${child.length} Characters`}
            labelInnerClassName='text-[10px] font-semibold align-bottom leading-7'
            dividerClassName='leading-7'
          />
        )
      })
    }

    if (chunkType === ChunkingMode.qa) {
      return (
        <div className='flex flex-col gap-2'>
          <QAItem type={QAItemType.Question} text={(content as QAChunk).question} />
          <QAItem type={QAItemType.Answer} text={(content as QAChunk).answer} />
        </div>
      )
    }

    return content as string
  }, [content, chunkType])

  return (
    <div className='flex flex-col gap-1 rounded-lg bg-components-panel-bg px-3 py-2.5'>
      {!isFullDoc && (
        <div className='inline-flex items-center justify-start gap-2'>
          <SegmentIndexTag
            positionId={positionId}
            labelPrefix={isParagraph ? 'Parent-Chunk' : 'Chunk'}
          />
          <Dot />
          <div className='system-xs-medium text-text-tertiary'>{`${formatNumber(wordCount)} ${t('datasetDocuments.segment.characters', { count: wordCount })}`}</div>
        </div>
      )}
      <div className='body-md-regular text-text-secondary'>{contentElement}</div>
    </div>
  )
}

export default React.memo(ChunkCard)
