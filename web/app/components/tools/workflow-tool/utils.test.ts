import type { WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema } from '../types'
import { VarType } from '@/app/components/workflow/types'
import { buildWorkflowOutputParameters } from './utils'

describe('buildWorkflowOutputParameters', () => {
  it('returns provided output parameters when array input exists', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'text', description: 'final text', type: VarType.string },
    ]

    const result = buildWorkflowOutputParameters(params, null)

    expect(result).toBe(params)
  })

  it('fills missing output description and type from schema when array input exists', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'answer', description: '', type: undefined },
      { name: 'files', description: 'keep this description', type: VarType.arrayFile },
    ]
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
          description: 'Generated answer',
        },
        files: {
          type: VarType.arrayFile,
          description: 'Schema files description',
        },
      },
    }

    const result = buildWorkflowOutputParameters(params, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'Generated answer', type: VarType.string },
      { name: 'files', description: 'keep this description', type: VarType.arrayFile },
    ])
  })

  it('falls back to empty description when both payload and schema descriptions are missing', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'missing_desc', description: '', type: undefined },
    ]
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        other_field: {
          type: VarType.string,
          description: 'Other',
        },
      },
    }

    const result = buildWorkflowOutputParameters(params, schema)

    expect(result).toEqual([
      { name: 'missing_desc', description: '', type: undefined },
    ])
  })

  it('derives parameters from schema when explicit array missing', () => {
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
          description: 'AI answer',
        },
        attachments: {
          type: VarType.arrayFile,
          description: 'Supporting files',
        },
        unknown: {
          type: 'custom',
          description: 'Unsupported type',
        },
      },
    }

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'AI answer', type: VarType.string },
      { name: 'attachments', description: 'Supporting files', type: VarType.arrayFile },
      { name: 'unknown', description: 'Unsupported type', type: undefined },
    ])
  })

  it('returns empty array when no source information is provided', () => {
    expect(buildWorkflowOutputParameters(null, null)).toEqual([])
  })

  it('derives parameters from schema when explicit array is empty', () => {
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        output_text: {
          type: VarType.string,
          description: 'Output text',
        },
      },
    }

    const result = buildWorkflowOutputParameters([], schema)

    expect(result).toEqual([
      { name: 'output_text', description: 'Output text', type: VarType.string },
    ])
  })

  it('returns undefined type when schema output type is missing', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: {
          description: 'Answer without type',
        },
      },
    } as unknown as WorkflowToolProviderOutputSchema

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'Answer without type', type: undefined },
    ])
  })

  it('falls back to empty description when schema-derived description is missing', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
        },
      },
    } as unknown as WorkflowToolProviderOutputSchema

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([
      { name: 'answer', description: '', type: VarType.string },
    ])
  })
})
