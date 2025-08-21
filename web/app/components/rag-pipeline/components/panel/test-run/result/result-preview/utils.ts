import { RAG_PIPELINE_PREVIEW_CHUNK_NUM } from '@/config'
import { type ChunkInfo, ChunkType } from '../../../../chunk-card-list'

type GeneralChunkPreview = {
  content: string
}

const formatGeneralChunks = (outputs: any) => {
  if (!outputs) return undefined
  const chunkInfo: ChunkInfo = {
    general_chunks: [],
  }
  const chunks = outputs.preview as GeneralChunkPreview[]
  chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM).forEach((chunk) => {
    chunkInfo.general_chunks?.push(chunk.content)
  })

  return chunkInfo
}

type ParentChildChunkPreview = {
  content: string
  child_chunks: string[]
}

const formatParentChildChunks = (outputs: any, chunkType: ChunkType) => {
  if (!outputs) return undefined
  const chunkInfo: ChunkInfo = {
    parent_child_chunks: [],
    parent_mode: chunkType,
  }
  const chunks = outputs.preview as ParentChildChunkPreview[]
  if (chunkType === ChunkType.Paragraph) {
    chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM).forEach((chunk) => {
      chunkInfo.parent_child_chunks?.push({
        parent_content: chunk.content,
        child_contents: chunk.child_chunks,
        parent_mode: chunkType,
      })
    })
    return chunkInfo
  }
  else {
    chunks.forEach((chunk) => {
      chunkInfo.parent_child_chunks?.push({
        parent_content: chunk.content,
        child_contents: chunk.child_chunks.slice(0, RAG_PIPELINE_PREVIEW_CHUNK_NUM),
        parent_mode: chunkType,
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
  if (!outputs) return undefined
  const chunkInfo: ChunkInfo = {
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

export const formatPreviewChunks = (chunkInfo: ChunkInfo, outputs: any): ChunkInfo | undefined => {
  if (!chunkInfo) return undefined

  let chunkType = ChunkType.General
  if (chunkInfo?.general_chunks)
    chunkType = ChunkType.General

  if (chunkInfo?.parent_child_chunks)
    chunkType = chunkInfo.parent_mode as ChunkType

  if (chunkInfo?.qa_chunks)
    chunkType = ChunkType.QA

  if (chunkType === ChunkType.General)
    return formatGeneralChunks(outputs)

  if (chunkType === ChunkType.Paragraph || chunkType === ChunkType.FullDoc)
    return formatParentChildChunks(outputs, chunkType)

  if (chunkType === ChunkType.QA)
    return formatQAChunks(outputs)

  return undefined
}
