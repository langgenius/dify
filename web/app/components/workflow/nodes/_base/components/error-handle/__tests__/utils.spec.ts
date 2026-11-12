import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createExternalAgentWorkflowPreviewData } from '@/features/agent-v2/external-agent/workflow-preview/preview'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import { getDefaultValue, mergeDefaultValue } from '../utils'

const externalAgentNode = (outputs?: DeclaredOutputConfig[]) =>
  createNode({
    data: {
      type: BlockEnum.Agent,
      ...createExternalAgentWorkflowPreviewData(createExternalRosterPreview()[1]!),
      agent_declared_outputs: outputs,
    },
  }).data

describe('external agent error defaults', () => {
  it('keeps LLM text and initializes boolean and generic array defaults', () => {
    expect(getDefaultValue(createNode({ data: { type: BlockEnum.LLM } }).data)).toEqual([
      { key: 'text', type: VarType.string, value: '' },
    ])
    expect(
      getDefaultValue(
        createNode({
          data: {
            type: BlockEnum.Code,
            outputs: {
              enabled: { type: VarType.boolean },
              items: { type: VarType.array },
            },
          },
        }).data,
      ),
    ).toEqual([
      { key: 'enabled', type: VarType.boolean, value: false },
      { key: 'items', type: VarType.array, value: '[]' },
    ])
  })

  it('uses configured external outputs without adding Agent V2 reserved outputs or file defaults', () => {
    expect(
      getDefaultValue(
        externalAgentNode([
          { name: 'summary', type: 'string' },
          { name: 'approved', type: 'boolean' },
          { name: 'flags', type: 'array', array_item: { type: 'boolean' } },
          { name: 'metadata', type: 'object' },
          { name: 'attachment', type: 'file' },
          { name: 'attachments', type: 'array', array_item: { type: 'file' } },
        ]),
      ),
    ).toEqual([
      { key: 'summary', type: VarType.string, value: '' },
      { key: 'approved', type: VarType.boolean, value: false },
      { key: 'flags', type: VarType.arrayBoolean, value: '[]' },
      { key: 'metadata', type: VarType.object, value: '{}' },
    ])
  })

  it('uses the external output fallback when the node has no configured outputs', () => {
    expect(getDefaultValue(externalAgentNode())).toEqual([
      { key: 'text', type: VarType.string, value: '' },
    ])
  })

  it('retains compatible defaults through external output additions, removals, renames, and type changes', () => {
    const previous = [
      { key: 'summary', type: VarType.string, value: 'Keep this summary.' },
      { key: 'approved', type: VarType.boolean, value: true },
      { key: 'confidence', type: VarType.string, value: 'high' },
      { key: 'removed', type: VarType.number, value: 7 },
    ]

    expect(
      mergeDefaultValue(
        externalAgentNode([
          { name: 'summary', type: 'string' },
          { name: 'is_approved', type: 'boolean' },
          { name: 'confidence', type: 'number' },
          { name: 'flags', type: 'array', array_item: { type: 'boolean' } },
          { name: 'upload', type: 'file' },
        ]),
        previous,
        { from: 'approved', to: 'is_approved' },
      ),
    ).toEqual([
      { key: 'summary', type: VarType.string, value: 'Keep this summary.' },
      { key: 'is_approved', type: VarType.boolean, value: true },
      { key: 'confidence', type: VarType.number, value: 0 },
      { key: 'flags', type: VarType.arrayBoolean, value: '[]' },
    ])
  })
})
