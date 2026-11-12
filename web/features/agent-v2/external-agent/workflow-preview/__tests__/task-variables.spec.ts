import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vite-plus/test'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { VarType } from '@/app/components/workflow/types'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import { getExternalAgentTaskVariableIssues } from '../task-variables'

const contractReview = createExternalRosterPreview()[1]!
const documentReview = { ...contractReview, key: 'document-review' }

const availableVars: NodeOutPutVar[] = [
  {
    nodeId: 'source',
    title: 'Source',
    vars: [
      { variable: 'summary', type: VarType.string },
      { variable: 'attachment', type: VarType.file },
      { variable: 'attachments', type: VarType.arrayFile },
      {
        variable: 'details',
        type: VarType.object,
        children: [{ variable: 'score', type: VarType.number }],
      },
      {
        variable: 'payload',
        type: VarType.object,
        children: {
          schema: {
            type: Type.object,
            additionalProperties: false,
            properties: {
              files: { type: Type.array, items: { type: Type.file } },
            },
          },
        },
      },
    ],
  },
  {
    nodeId: 'sys',
    title: 'System',
    vars: [{ variable: 'sys.query', type: VarType.string }],
  },
  {
    nodeId: 'env',
    title: 'Environment',
    vars: [{ variable: 'env.contract_name', type: VarType.string }],
  },
  {
    nodeId: 'conversation',
    title: 'Conversation',
    vars: [{ variable: 'conversation.topic', type: VarType.string }],
  },
  {
    nodeId: 'rag',
    title: 'Knowledge',
    vars: [{ variable: 'rag.shared.context', type: VarType.string }],
  },
]

describe('getExternalAgentTaskVariableIssues', () => {
  it('reports each unique unsupported variable using its resolved nested type', () => {
    const issues = getExternalAgentTaskVariableIssues(
      contractReview,
      [
        '{{#source.attachment#}}',
        '{{#source.attachments#}}',
        '{{#source.details.score#}}',
        '{{#source.payload.files#}}',
        '{{#source.attachment#}}',
      ].join(' '),
      availableVars,
    )

    expect(issues).toEqual([
      {
        selector: ['source', 'attachment'],
        variable: 'attachment',
        type: VarType.file,
      },
      {
        selector: ['source', 'attachments'],
        variable: 'attachments',
        type: VarType.arrayFile,
      },
      {
        selector: ['source', 'details', 'score'],
        variable: 'details.score',
        type: VarType.number,
      },
      {
        selector: ['source', 'payload', 'files'],
        variable: 'payload.files',
        type: VarType.arrayFile,
      },
    ])
  })

  it('accepts PDF-capable file inputs and flattened special variables', () => {
    const issues = getExternalAgentTaskVariableIssues(
      documentReview,
      [
        '{{#source.summary#}}',
        '{{#source.attachment#}}',
        '{{#source.attachments#}}',
        '{{#sys.query#}}',
        '{{#env.contract_name#}}',
        '{{#conversation.topic#}}',
        '{{#rag.shared.context#}}',
      ].join(' '),
      availableVars,
    )

    expect(issues).toEqual([])
  })

  it('does not assign an unsupported type to a missing task reference', () => {
    const issues = getExternalAgentTaskVariableIssues(
      contractReview,
      '{{#removed.output#}}',
      availableVars,
    )

    expect(issues).toEqual([])
  })
})
