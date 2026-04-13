import type { ChunkInfo, GeneralChunk, GeneralChunks, ParentChildChunk, ParentChildChunks, QAChunk, QAChunks } from './types'
import type { ParentMode } from '@/models/datasets'
import { useMemo } from 'react'
import { ChunkingMode } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import ChunkCard from './chunk-card'

type ChunkCardListProps = {
  chunkType: ChunkingMode
  parentMode?: ParentMode
  chunkInfo: ChunkInfo
  className?: string
}

export const ChunkCardList = (props: ChunkCardListProps) => {
  const { chunkType, parentMode, chunkInfo, className } = props

  const chunkList = useMemo(() => {
    if (chunkType === ChunkingMode.text)
      return chunkInfo as GeneralChunks
    if (chunkType === ChunkingMode.parentChild)
      return (chunkInfo as ParentChildChunks).parent_child_chunks
    return (chunkInfo as QAChunks).qa_chunks
  }, [chunkInfo, chunkType])

  const getWordCount = (seg: GeneralChunk | ParentChildChunk | QAChunk) => {
    if (chunkType === ChunkingMode.parentChild)
      return (seg as ParentChildChunk).parent_content?.length
    if (chunkType === ChunkingMode.text)
      return (seg as GeneralChunk).content.length
    return (seg as QAChunk).question.length + (seg as QAChunk).answer.length
  }

  return (
    <div className={cn('flex w-full flex-col gap-y-1', className)}>
      {chunkList.map((seg, index: number) => {
        const wordCount = getWordCount(seg)

        return (
          <ChunkCard
            key={`${chunkType}-${index}`}
            chunkType={chunkType}
            parentMode={parentMode}
            content={seg}
            wordCount={wordCount}
            positionId={index + 1}
          />
        )
      })}
    </div>
  )
}
