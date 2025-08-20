import { useMemo } from 'react'
import SegmentIndexTag from '@/app/components/datasets/documents/detail/completed/common/segment-index-tag'
import Dot from '@/app/components/datasets/documents/detail/completed/common/dot'
import { PreviewSlice } from '@/app/components/datasets/formatted-text/flavours/preview-slice'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/utils/format'
import cn from '@/utils/classnames'

enum QAItemType {
  Question = 'question',
  Answer = 'answer',
}

type QAItemProps = {
  type: QAItemType
  text: string
}

const QAItem = (props: QAItemProps) => {
  const { type, text } = props
  return <div className='inline-flex items-start justify-start gap-1 self-stretch'>
    <div className='w-4 text-[13px] font-medium leading-5 text-text-tertiary'>{type === QAItemType.Question ? 'Q' : 'A'}</div>
    <div className='body-md-regular flex-1 text-text-secondary'>{text}</div>
  </div>
}

enum ChunkType {
  General = 'general',
  Paragraph = 'paragraph',
  FullDoc = 'full-doc',
  QA = 'qa',
}

type ChunkCardProps = {
  type: ChunkType
  content: string | string[] | QAChunk
  positionId?: string | number
  wordCount: number
}

const ChunkCard = (props: ChunkCardProps) => {
  const { type, content, positionId, wordCount } = props
  const { t } = useTranslation()

  const renderContent = () => {
    // ChunkType.Paragraph && ChunkType.FullDoc
    if (Array.isArray(content)) {
      return content.map((child, index) => {
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

    // ChunkType.QA
    if (typeof content === 'object') {
      return <div className='flex flex-col gap-2'>
        <QAItem type={QAItemType.Question} text={(content as QAChunk).question} />
        <QAItem type={QAItemType.Answer} text={(content as QAChunk).answer} />
      </div>
    }

    // ChunkType.General
    return content
  }

  return (
    <div className='flex flex-col gap-1 rounded-lg bg-components-panel-bg px-3 py-2.5'>
      {type !== ChunkType.FullDoc && <div className='inline-flex items-center justify-start gap-2'>
        <SegmentIndexTag
          positionId={positionId}
          labelPrefix={type === ChunkType.Paragraph ? 'Parent-Chunk' : 'Chunk'}
        />
        <Dot />
        <div className='system-xs-medium text-text-tertiary'>{formatNumber(wordCount)} {t('datasetDocuments.segment.characters', { count: wordCount })}</div>
      </div>}
      <div className='body-md-regular text-text-secondary'>{renderContent()}</div>
    </div>
  )
}

export type ChunkInfo = {
  general_chunks?: string[]
  parent_child_chunks?: ParentChildChunk[]
  parent_mode?: string
  qa_chunks?: QAChunk[]
}

type ParentChildChunk = {
  child_contents: string[]
  parent_content: string
  parent_mode: string
}

type QAChunk = {
  question: string
  answer: string
}

type ChunkCardListProps = {
  chunkInfo: ChunkInfo
  className?: string
}

export const ChunkCardList = (props: ChunkCardListProps) => {
  const { chunkInfo, className } = props

  const chunkType = useMemo(() => {
    if (chunkInfo?.general_chunks)
      return ChunkType.General

    if (chunkInfo?.parent_child_chunks)
      return chunkInfo.parent_mode as ChunkType

    return ChunkType.QA
  }, [chunkInfo])

  const chunkList = useMemo(() => {
    if (chunkInfo?.general_chunks)
      return chunkInfo.general_chunks
    if (chunkInfo?.parent_child_chunks)
      return chunkInfo.parent_child_chunks
    return chunkInfo?.qa_chunks ?? []
  }, [chunkInfo])

  return (
    <div className={cn('flex w-full flex-col gap-y-1', className)}>
      {chunkList.map((seg: string | ParentChildChunk | QAChunk, index: number) => {
        const isParentChildMode = [ChunkType.Paragraph, ChunkType.FullDoc].includes(chunkType!)
        let wordCount = 0
        if (isParentChildMode)
          wordCount = (seg as ParentChildChunk)?.parent_content?.length
        else if (typeof seg === 'string')
          wordCount = seg.length
        else
          wordCount = (seg as QAChunk)?.question?.length + (seg as QAChunk)?.answer?.length

        return (
          <ChunkCard
            type={chunkType}
            content={isParentChildMode ? (seg as ParentChildChunk).child_contents : (seg as string | QAChunk)}
            wordCount={wordCount}
            positionId={index + 1}
          />
        )
      })}
    </div>
  )
}
