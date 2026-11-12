import type { ExternalAgentListItem } from '../roster/components/external-agent-list'

export type ExternalAgentOverviewFallbackAgent = Pick<
  ExternalAgentListItem,
  'key' | 'name' | 'role' | 'description' | 'icon' | 'enabled'
>

export type ExternalAgentSkillPreview = {
  id: string
  name: string
  description: string
  tags: string[]
  inputFormats?: string[]
  outputFormats?: string[]
  examples: string[]
}

export type ExternalAgentTestTracePreview = {
  id: string
  name: string
  elapsedSeconds: number
  input: string
  output: string
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
  sampleTraceSteps: ExternalAgentTestTracePreview[]
}

export function createExternalAgentOverviewPreview(
  agent: ExternalAgentListItem,
): ExternalAgentOverviewPreview {
  if (agent.key !== 'vendor-screening' && agent.key !== 'contract-review')
    return createOtherAgentPreview(agent)

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
          {
            id: 'ownership-check',
            name: 'Ownership check',
            description:
              'Maps a vendor’s parent companies and beneficial owners, highlighting ownership information that still needs confirmation.',
            tags: ['ownership', 'due-diligence'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'Identify the beneficial owners listed in this company registration document.',
              'Which ownership details should we confirm before onboarding this supplier?',
            ],
          },
          {
            id: 'financial-risk',
            name: 'Financial risk assessment',
            description:
              'Reviews supplied financial statements for signs of liquidity pressure, unusual liabilities, and dependence on a small number of customers.',
            tags: ['finance', 'risk'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'Summarize the financial risks in this supplier’s latest annual report.',
              'Highlight changes in working capital that need a follow-up question.',
            ],
          },
          {
            id: 'security-questionnaire',
            name: 'Security questionnaire review',
            description:
              'Compares a vendor’s security questionnaire with procurement requirements and identifies missing evidence or answers that need clarification.',
            tags: ['security', 'compliance'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Review these security answers against our supplier requirements.',
              'Draft follow-up questions for any missing access-control evidence.',
            ],
          },
          {
            id: 'privacy-assessment',
            name: 'Privacy assessment',
            description:
              'Checks how a supplier collects, stores, and shares personal data, with attention to retention periods and international transfers.',
            tags: ['privacy', 'data-protection'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'What privacy risks should we review before sharing customer data?',
              'Identify unclear data-retention terms in this vendor policy.',
            ],
          },
          {
            id: 'certificate-review',
            name: 'Certificate review',
            description:
              'Summarizes the scope and expiry dates of supplied certifications and flags documents that do not cover the service being purchased.',
            tags: ['certification', 'evidence'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'Check whether these certifications cover the vendor’s hosting service.',
              'List the certificates that will expire within the next quarter.',
            ],
          },
          {
            id: 'vendor-comparison',
            name: 'Vendor comparison',
            description:
              'Organizes the available evidence for shortlisted vendors into a consistent comparison of capabilities, risks, and outstanding questions.',
            tags: ['procurement', 'comparison'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Compare these three suppliers using our onboarding criteria.',
              'Show the evidence gaps that prevent a like-for-like comparison.',
            ],
          },
          {
            id: 'onboarding-summary',
            name: 'Onboarding summary',
            description:
              'Prepares a concise procurement handoff with the screening findings, recommended follow-up actions, and documents still required.',
            tags: ['onboarding', 'reporting'],
            inputFormats: ['Text'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Prepare a vendor onboarding summary for the procurement team.',
              'List the remaining actions and the team responsible for each one.',
            ],
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
            inputFormats: ['Text'],
            outputFormats: ['Text'],
            examples: [
              'Rewrite this limitation of liability clause so damages are capped at fees paid.',
            ],
          },
          {
            id: 'contract-comparison',
            name: 'Contract comparison',
            description:
              'Compares two versions of an agreement and explains how changes affect each party’s obligations, rights, and exposure.',
            tags: ['legal', 'comparison'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Summarize the material changes between these two contract versions.',
              'Which edits increase our obligations compared with the signed agreement?',
            ],
          },
          {
            id: 'obligation-extraction',
            name: 'Obligation extraction',
            description:
              'Extracts deliverables, notice requirements, and recurring obligations so the contract owner can track commitments after signing.',
            tags: ['contracts', 'operations'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'List our reporting obligations and the deadlines for each one.',
              'Extract the notice requirements that apply before renewing this agreement.',
            ],
          },
          {
            id: 'payment-terms',
            name: 'Payment terms analysis',
            description:
              'Reviews invoicing schedules, payment deadlines, late fees, and disputed-charge provisions against the supplied purchasing policy.',
            tags: ['finance', 'contracts'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'Check these payment terms against our standard purchasing policy.',
              'Explain when we can withhold payment for a disputed invoice.',
            ],
          },
          {
            id: 'renewal-planning',
            name: 'Renewal planning',
            description:
              'Identifies renewal dates, automatic extensions, and cancellation windows, then summarizes the decisions needed before each deadline.',
            tags: ['renewals', 'planning'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'When must we give notice to avoid renewing this contract?',
              'Summarize the price changes that apply at the next renewal.',
            ],
          },
          {
            id: 'confidentiality-review',
            name: 'Confidentiality review',
            description:
              'Reviews confidentiality definitions, permitted disclosures, and survival periods for inconsistencies with the intended business relationship.',
            tags: ['confidentiality', 'risk'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text'],
            examples: [
              'Does this confidentiality clause cover information shared before signing?',
              'Flag disclosure exceptions that need a narrower definition.',
            ],
          },
          {
            id: 'negotiation-brief',
            name: 'Negotiation brief',
            description:
              'Turns review findings into a prioritized negotiation brief with proposed wording, fallback positions, and questions for the counterparty.',
            tags: ['negotiation', 'drafting'],
            inputFormats: ['Text', 'PDF'],
            outputFormats: ['Text', 'PDF'],
            examples: [
              'Prepare a negotiation brief for the five highest-priority contract risks.',
              'Suggest a fallback position for each disputed clause.',
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
      : 'The 90-day payment period conflicts with your 30-day payment policy.\n\nSuggested wording: “Payment is due within 30 days of invoice. Late fees apply only after a 10-day grace period agreed in writing.”',
    sampleTraceSteps: [
      {
        id: vendor ? 'search-vendor-policy' : 'search-contract-policy',
        name: vendor ? 'search_vendor_policy' : 'search_contract_policy',
        elapsedSeconds: 0.8,
        input: vendor
          ? 'Vendor sanctions and risk screening policy'
          : 'Payment terms and late-fee policy',
        output: vendor
          ? 'No sanctions matches found. Ownership and registration details require confirmation.'
          : 'Payment is due within 30 days of invoice. Late fees require a 10-day grace period agreed in writing.',
      },
    ],
  }
}

function createOtherAgentPreview(agent: ExternalAgentListItem): ExternalAgentOverviewPreview {
  const skills: ExternalAgentSkillPreview[] = []
  let sampleResponse = ''

  if (agent.key === 'document-review') {
    skills.push({
      id: 'document-review',
      name: 'Document review',
      description: 'Reviews a document and highlights missing or inconsistent information.',
      tags: ['documents', 'review'],
      inputFormats: ['Text', 'PDF'],
      outputFormats: ['Text'],
      examples: [
        'Review this document and summarize the information that needs attention.',
        'List the details we should confirm before approving this document.',
      ],
    })
    sampleResponse =
      'The document is missing an approval date. Confirm the owner and the supporting evidence before approval.'
  }

  if (agent.key === 'invoice-audit') {
    skills.push({
      id: 'invoice-audit',
      name: 'Invoice audit',
      description: 'Checks invoice amounts, line items, and payment details for discrepancies.',
      tags: ['finance', 'invoices'],
      inputFormats: ['Text', 'PDF'],
      outputFormats: ['Text'],
      examples: [
        'Check this invoice against the purchase order and flag any discrepancies.',
        'Identify duplicate charges and missing payment details in this invoice.',
      ],
    })
    sampleResponse =
      'One line item differs from the purchase order. Confirm the unit price and invoice total before payment.'
  }

  const hasPreview = skills.length > 0
  return {
    agent: { ...agent, apps: [] },
    defaultInputFormats: hasPreview ? ['Text', 'PDF'] : [],
    defaultOutputFormats: hasPreview ? ['Text'] : [],
    skills,
    endpoint: hasPreview ? `https://agents.acme.example/${agent.key}` : '',
    authentication: hasPreview ? 'bearer' : 'none',
    token: '',
    protocol: hasPreview ? 'A2A 1.0' : '',
    verifiedAt: '2026-10-14',
    connectedBy: hasPreview ? 'Jamie Lee' : '',
    tracing: hasPreview,
    provider: hasPreview ? 'Acme' : '',
    version: hasPreview ? '1.4.2' : '',
    documentationUrl: hasPreview ? 'https://agents.acme.example/docs' : '',
    sampleResponse,
    sampleTraceSteps: [],
  }
}
