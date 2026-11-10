import type { ExternalAgentListItem } from '../roster/components/external-agent-list'

export type ExternalAgentSkillPreview = {
  id: string
  name: string
  description: string
  tags: string[]
  inputFormats?: string[]
  outputFormats?: string[]
  examples: string[]
}

export type ExternalAgentOverviewPreview = {
  agent: ExternalAgentListItem
  defaultInputFormats: string[]
  defaultOutputFormats: string[]
  skills: ExternalAgentSkillPreview[]
  endpoint: string
  authentication: 'none' | 'bearer'
  token: string
  protocol: string
  verifiedAt: string
  connectedBy: string
  tracing: boolean
  provider: string
  version: string
  documentationUrl: string
  sampleResponse: string
}

export function createExternalAgentOverviewPreview(
  agent: ExternalAgentListItem,
): ExternalAgentOverviewPreview {
  const vendor = agent.key === 'vendor-screening'
  return {
    agent,
    defaultInputFormats: ['Text'],
    defaultOutputFormats: ['Text'],
    skills: vendor
      ? [
          {
            id: 'vendor-screening',
            name: 'Vendor screening',
            description: 'Checks a vendor against sanctions and risk lists.',
            tags: ['procurement', 'risk'],
            inputFormats: ['Text'],
            outputFormats: ['Text'],
            examples: ['Screen this vendor against our sanctions and risk lists.'],
          },
        ]
      : [
          {
            id: 'contract-review',
            name: 'Contract review',
            description:
              'Reads a contract clause by clause and flags terms that conflict with your policies.',
            tags: ['legal', 'contracts'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Review this payment clause and suggest a safer alternative.',
              'Does this termination clause favor the supplier?',
              'Flag any terms that conflict with our 30-day payment policy.',
            ],
          },
          {
            id: 'clause-rewrite',
            name: 'Clause rewrite',
            description: 'Suggests safer wording for a clause while keeping its original intent.',
            tags: ['legal', 'drafting'],
            examples: [
              'Rewrite this limitation of liability clause so damages are capped at fees paid.',
            ],
          },
        ],
    endpoint: `https://agents.acme.example/${vendor ? 'vendor-screening' : 'contract-review'}`,
    authentication: 'bearer',
    token: '',
    protocol: 'A2A 1.0',
    verifiedAt: '2026-10-14',
    connectedBy: 'Jamie Lee',
    tracing: true,
    provider: 'Acme',
    version: '1.4.2',
    documentationUrl: 'https://agents.acme.example/docs',
    sampleResponse: vendor
      ? 'No matches were found in the sample sanctions list. Confirm the vendor’s ownership and registration details before proceeding.'
      : 'The clause allows payment beyond your company’s 30-day policy. Consider revising the payment term to 30 days from receipt of a valid invoice.',
  }
}
