import type { GeneralChunk, ParentChildChunk, QAChunk } from './types'
import type { ParentMode } from '@/models/datasets'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Dot from '@/app/components/datasets/documents/detail/completed/common/dot'
import SegmentIndexTag from '@/app/components/datasets/documents/detail/completed/common/segment-index-tag'
import SummaryLabel from '@/app/components/datasets/documents/detail/completed/common/summary-label'
import { PreviewSlice } from '@/app/components/datasets/formatted-text/flavours/preview-slice'
import { ChunkingMode } from '@/models/datasets'
import { formatNumber } from '@/utils/format'
import QAItem from './q-a-item'
import { QAItemType } from './types'

type ChunkCardProps = {
  chunkType: ChunkingMode
  parentMode?: ParentMode
  content: ParentChildChunk | QAChunk | GeneralChunk
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
      return (content as ParentChildChunk).child_contents.map((child, index) => {
        const indexForLabel = index + 1
        return (
          <PreviewSlice
            key={child}
            label={`C-${indexForLabel}`}
            text={child}
            tooltip={`Child-chunk-${indexForLabel} · ${child.length} Characters`}
            labelInnerClassName="text-[10px] font-semibold align-bottom leading-7"
            dividerClassName="leading-7"
          />
        )
      })
    }

    if (chunkType === ChunkingMode.qa) {
      return (
        <div className="flex flex-col gap-2">
          <QAItem type={QAItemType.Question} text={(content as QAChunk).question} />
          <QAItem type={QAItemType.Answer} text={(content as QAChunk).answer} />
        </div>
      )
    }

    return (content as GeneralChunk).content
  }, [content, chunkType])

  const summaryElement = useMemo(() => {
    if (chunkType === ChunkingMode.parentChild) {
      return (content as ParentChildChunk).parent_summary
    }
    if (chunkType === ChunkingMode.text) {
      return (content as GeneralChunk).summary
    }
    return null
  }, [content, chunkType])

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-components-panel-bg px-3 py-2.5">
      {!isFullDoc && (
        <div className="inline-flex items-center justify-start gap-2">
          <SegmentIndexTag
            positionId={positionId}
            labelPrefix={isParagraph ? 'Parent-Chunk' : 'Chunk'}
          />
          <Dot />
          <div className="system-xs-medium text-text-tertiary">{`${formatNumber(wordCount)} ${t('segment.characters', { ns: 'datasetDocuments', count: wordCount })}`}</div>
        </div>
      )}
      <div className="body-md-regular text-text-secondary">{contentElement}</div>
      {summaryElement && <SummaryLabel summary={summaryElement} />}
    </div>
  )
}

export default React.memo(ChunkCard)
