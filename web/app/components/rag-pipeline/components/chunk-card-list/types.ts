export type GeneralChunks = string[]

export type ParentChildChunk = {
  child_contents: string[]
  parent_content: string
  parent_mode: string
}

export type ParentChildChunks = {
  parent_child_chunks: ParentChildChunk[]
  parent_mode: string
}

export type QAChunk = {
  question: string
  answer: string
}

export type QAChunks = {
  qa_chunks: QAChunk[]
}

export type ChunkInfo = GeneralChunks | ParentChildChunks | QAChunks

export enum QAItemType {
  Question = 'question',
  Answer = 'answer',
}
