import type { ExternalAgentWorkflowPreviewAgent } from '@/features/agent-v2/external-agent/workflow-preview/types'

// Local examples for the external Agent picker until its API is available.
export const externalWorkflowAgentExamples: readonly ExternalAgentWorkflowPreviewAgent[] = [
  {
    key: 'contract-review',
    name: 'Contract Review Agent',
    role: 'Legal & compliance',
    description: 'Reviews contract clauses against your company’s policies.',
    enabled: true,
  },
  {
    key: 'document-review',
    name: 'Document Review Agent',
    role: 'Document review',
    description: 'Reviews documents and highlights information that needs attention.',
    enabled: true,
  },
  {
    key: 'invoice-audit',
    name: 'Invoice Audit Agent',
    role: 'Finance',
    description: 'Checks invoices for discrepancies and missing information.',
    enabled: false,
  },
]
