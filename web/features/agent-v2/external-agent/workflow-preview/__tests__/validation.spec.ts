import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import { describe, expect, it } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { toExternalAgentOverview } from '@/features/agent-v2/external-agent/model'
import { createExternalAgentAsset, createExternalAgentDetail } from '@/test/console/external-agents'
import { createExternalAgentWorkflowPreviewData } from '../defaults'
import {
  containsExternalFileOutput,
  getExternalAgentNodeIssues,
  hasUnsupportedExternalOutputs,
} from '../validation'

describe('external workflow validation', () => {
  it('admits a bound configured external node and reports unavailable binding and asset states', () => {
    const asset = createExternalAgentAsset()
    const node: ExternalAgentWorkflowPreviewNodeData = {
      ...createExternalAgentWorkflowPreviewData(asset),
      type: BlockEnum.Agent,
      title: asset.name,
      desc: '',
      agent_binding: {
        binding_type: 'roster_agent',
        agent_id: asset.id,
        binding_epoch: 'server-epoch',
      },
      agent_task: 'Review this contract.',
    }
    const overview = toExternalAgentOverview(createExternalAgentDetail({ asset }))
    expect(getExternalAgentNodeIssues(node, overview, true, [], ['text/plain']).issues).toEqual([])
    expect(
      getExternalAgentNodeIssues(
        { ...node, agent_binding: { binding_type: 'roster_agent' } },
        undefined,
        false,
        [],
        [],
      ).issues,
    ).toEqual(['unconnected', 'unavailable'])
    expect(
      getExternalAgentNodeIssues(
        node,
        { ...overview, asset: { ...asset, enabled: false } },
        true,
        [],
        ['text/plain'],
      ).issues,
    ).toEqual(['disabled'])
  })

  it('rejects unsupported execution retry and nested file defaults without rejecting ordinary output declarations', () => {
    expect(hasUnsupportedExternalOutputs([{ name: 'text', type: 'string', required: true }])).toBe(
      false,
    )
    expect(
      hasUnsupportedExternalOutputs([
        { name: 'text', type: 'string', failure_strategy: { retry: { enabled: true } } },
      ]),
    ).toBe(true)
    const output = {
      name: 'document',
      type: 'object' as const,
      children: [{ name: 'attachment', type: 'file' as const }],
    }
    expect(containsExternalFileOutput(output)).toBe(true)
    expect(
      hasUnsupportedExternalOutputs([
        { ...output, failure_strategy: { on_failure: 'default_value', default_value: {} } },
      ]),
    ).toBe(true)
  })
})
