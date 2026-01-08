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
})
