import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'
import { VarType } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import {
  buildWorkflowToolRequestPayload,
  getReservedWorkflowOutputParameters,
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
    const t = withSelectorKey(
      (key: string, options?: { ns?: string }) => `${options?.ns}:${key}`,
    ) as TFunction<['workflow']>

    expect(getReservedWorkflowOutputParameters(t)).toEqual([
      {
        name: 'text',
        type: VarType.string,
        reserved: true,
        description: 'workflow:nodes.tool.outputVars.text',
      },
      {
        name: 'files',
        type: VarType.arrayFile,
        reserved: true,
        description: 'workflow:nodes.tool.outputVars.files.title',
      },
      {
        name: 'json',
        type: VarType.arrayObject,
        reserved: true,
        description: 'workflow:nodes.tool.outputVars.json',
      },
    ])
  })

  it('detects reserved output conflicts', () => {
    expect(hasReservedWorkflowOutputConflict(RESERVED_WORKFLOW_OUTPUTS, 'text')).toBe(true)
    expect(hasReservedWorkflowOutputConflict(RESERVED_WORKFLOW_OUTPUTS, 'custom')).toBe(false)
  })

  it('builds workflow tool request payload', () => {
    expect(
      buildWorkflowToolRequestPayload({
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
      }),
    ).toEqual({
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
