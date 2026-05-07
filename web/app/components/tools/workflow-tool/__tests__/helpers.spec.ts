import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { VarType } from '@/app/components/workflow/types'
import {
  buildWorkflowToolRequestPayload,
  getReservedWorkflowOutputParameters,
  getWorkflowOutputParameters,
  hasReservedWorkflowOutputConflict,
  isWorkflowToolNameValid,
  RESERVED_WORKFLOW_OUTPUTS,
} from '../helpers'

describe('workflow-tool helpers', () => {
  it('validates workflow tool names', () => {
    expect(isWorkflowToolNameValid('')).toBe(true)
    expect(isWorkflowToolNameValid('workflow_tool_1')).toBe(true)
    expect(isWorkflowToolNameValid('workflow-tool')).toBe(false)
    expect(isWorkflowToolNameValid('workflow tool')).toBe(false)
  })

  it('builds translated reserved workflow outputs', () => {
    const t = ((key: string, options?: { ns?: string }) => `${options?.ns}:${key}`) as TFunction

    expect(getReservedWorkflowOutputParameters(t)).toEqual([
      {
        ...RESERVED_WORKFLOW_OUTPUTS[0],
        description: 'workflow:nodes.tool.outputVars.text',
      },
      {
        ...RESERVED_WORKFLOW_OUTPUTS[1],
        description: 'workflow:nodes.tool.outputVars.files.title',
      },
      {
        ...RESERVED_WORKFLOW_OUTPUTS[2],
        description: 'workflow:nodes.tool.outputVars.json',
      },
    ])
  })

  it('detects reserved output conflicts', () => {
    expect(hasReservedWorkflowOutputConflict(RESERVED_WORKFLOW_OUTPUTS, 'text')).toBe(true)
    expect(hasReservedWorkflowOutputConflict(RESERVED_WORKFLOW_OUTPUTS, 'custom')).toBe(false)
  })

  it('derives workflow output parameters from schema through helper wrapper', () => {
    expect(getWorkflowOutputParameters([], {
      type: 'object',
      properties: {
        text: {
          type: VarType.string,
          description: 'Result text',
        },
      },
    })).toEqual([
      {
        name: 'text',
        description: 'Result text',
        type: VarType.string,
      },
    ])
  })

  it('builds workflow tool request payload', () => {
    expect(buildWorkflowToolRequestPayload({
      name: 'workflow_tool',
      description: 'Workflow tool',
      emoji: {
        content: '🧠',
        background: '#ffffff',
      },
      label: 'Workflow Tool',
      labels: ['agent', 'workflow'],
      parameters: [
        {
          name: 'question',
          type: VarType.string,
          required: true,
          form: 'llm',
          description: 'Question to ask',
        },
      ],
      privacyPolicy: 'https://example.com/privacy',
    })).toEqual({
      name: 'workflow_tool',
      description: 'Workflow tool',
      icon: {
        content: '🧠',
        background: '#ffffff',
      },
      label: 'Workflow Tool',
      labels: ['agent', 'workflow'],
      parameters: [
        {
          name: 'question',
          description: 'Question to ask',
          form: 'llm',
        },
      ],
      privacy_policy: 'https://example.com/privacy',
    })
  })
})
