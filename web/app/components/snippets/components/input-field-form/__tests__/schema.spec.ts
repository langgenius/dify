import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'
import { createSnippetInputFieldSchema, TEXT_MAX_LENGTH } from '../schema'

vi.mock('@/config', () => ({
  MAX_VAR_KEY_LENGTH: 30,
}))

const t: TFunction = ((key: string) => key) as unknown as TFunction

describe('createSnippetInputFieldSchema', () => {
  const defaultOptions = { maxFileUploadLimit: 10 }

  it('should allow text-input maxLength to be omitted', () => {
    const schema = createSnippetInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
    const result = schema.safeParse({
      type: 'text-input',
      variable: 'text_var',
      label: 'Text',
      required: false,
    })

    expect(result.success).toBe(true)
  })

  it('should still reject text-input maxLength above the limit', () => {
    const schema = createSnippetInputFieldSchema(PipelineInputVarType.textInput, t, defaultOptions)
    const result = schema.safeParse({
      type: 'text-input',
      variable: 'text_var',
      label: 'Text',
      required: false,
      maxLength: TEXT_MAX_LENGTH + 1,
    })

    expect(result.success).toBe(false)
  })

  it('should allow paragraph maxLength to be omitted', () => {
    const schema = createSnippetInputFieldSchema(PipelineInputVarType.paragraph, t, defaultOptions)
    const result = schema.safeParse({
      type: 'paragraph',
      variable: 'paragraph_var',
      label: 'Paragraph',
      required: false,
    })

    expect(result.success).toBe(true)
  })
})
