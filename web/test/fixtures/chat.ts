import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { Annotation } from '@/models/log'
import { PromptMode } from '@/models/debug'
import { TransferMethod } from '@/types/app'
import { createDatasetConfigsFixture } from './debug-configuration'

export const createChatConfigFixture = (overrides: Partial<ChatConfig> = {}): ChatConfig => ({
  opening_statement: '',
  pre_prompt: '',
  prompt_type: PromptMode.simple,
  user_input_form: [],
  more_like_this: { enabled: false },
  suggested_questions_after_answer: { enabled: false },
  speech_to_text: { enabled: false },
  text_to_speech: { enabled: false },
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  agent_mode: { enabled: false, tools: [] },
  dataset_configs: createDatasetConfigsFixture(),
  ...overrides,
})

export const createChatFileFixture = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'attachment.txt',
  type: 'text/plain',
  size: 100,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'upload-1',
  ...overrides,
})

export const createChatThoughtFixture = (overrides: Partial<ThoughtItem> = {}): ThoughtItem => ({
  id: 'thought-1',
  tool: '',
  thought: '',
  tool_input: '{}',
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  observation: '',
  position: 0,
  ...overrides,
})

export const createChatAnnotationFixture = (content: string): Annotation => ({
  id: 'annotation-1',
  authorName: 'Editor',
  logAnnotation: {
    id: 'annotation-1',
    content,
    created_at: 1700000000,
    account: { id: 'editor-1', name: 'Editor', email: 'editor@example.com' },
  },
})
