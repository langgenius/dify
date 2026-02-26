import type { ChunkInfo, GeneralChunks, ParentChildChunks, QAChunks } from '../../../../chunk-card-list/types'
import type { ParentMode } from '@/models/datasets'
import { RAG_PIPELINE_PREVIEW_CHUNK_NUM } from '@/config'
import { ChunkingMode } from '@/models/datasets'

type GeneralChunkPreview = {
  content: string
  summary?: string
}

const formatGeneralChunks = (outputs: any) => {
  const chunkInfo: GeneralChunks = []
  const chunks = outputs.preview as GeneralChunkPreview[]
  chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM).forEach((chunk) => {
    chunkInfo.push({
      content: chunk.content,
      summary: chunk.summary,
    })
  })

  return chunkInfo
}

type ParentChildChunkPreview = {
  content: string
  child_chunks: string[]
  summary?: string
}

const formatParentChildChunks = (outputs: any, parentMode: ParentMode) => {
  const chunkInfo: ParentChildChunks = {
    parent_child_chunks: [],
    parent_mode: parentMode,
  }
  const chunks = outputs.preview as ParentChildChunkPreview[]
  if (parentMode === 'paragraph') {
    chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM).forEach((chunk) => {
      chunkInfo.parent_child_chunks?.push({
        parent_content: chunk.content,
        parent_summary: chunk.summary,
        child_contents: chunk.child_chunks,
        parent_mode: parentMode,
      })
    })
  }
  if (parentMode === 'full-doc') {
    chunks.forEach((chunk) => {
      chunkInfo.parent_child_chunks?.push({
        parent_content: chunk.content,
        child_contents: chunk.child_chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM),
        parent_mode: parentMode,
      })
    })
  }

  return chunkInfo
}

type QAChunkPreview = {
  question: string
  answer: string
}

const formatQAChunks = (outputs: any) => {
  const chunkInfo: QAChunks = {
    qa_chunks: [],
  }
  const chunks = outputs.qa_preview as QAChunkPreview[]
  chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM).forEach((chunk) => {
    chunkInfo.qa_chunks?.push({
      ...chunk,
    })
  })

  return chunkInfo
}

export const formatPreviewChunks = (outputs: any): ChunkInfo | undefined => {
  if (!outputs)
    return undefined

  const chunkingMode = outputs.chunk_structure
  const parentMode = outputs.parent_mode

  if (chunkingMode === ChunkingMode.text)
    return formatGeneralChunks(outputs)

  if (chunkingMode === ChunkingMode.parentChild)
    return formatParentChildChunks(outputs, parentMode)

  if (chunkingMode === ChunkingMode.qa)
    return formatQAChunks(outputs)

  return undefined
}
