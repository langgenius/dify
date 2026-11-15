import type {
  ExternalAgentAssetResponse,
  ExternalAgentCapabilitiesResponse,
  ExternalAgentDetailResponse,
  ExternalAgentReferencesResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'

export function createExternalAgentAsset(
  overrides: Partial<ExternalAgentAssetResponse> = {},
): ExternalAgentAssetResponse {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: '99999999-9999-4999-8999-999999999999',
    active_connection_revision_id: '33333333-3333-4333-8333-333333333333',
    created_by: '11111111-1111-4111-8111-111111111111',
    name: 'Contract Review Agent',
    description: 'Reviews contracts for risky terms.',
    role: 'Legal and compliance',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#E0E7FF',
    enabled: true,
    tracing_enabled: true,
    metadata_revision: 1,
    row_version: 1,
    test_display_generation: 1,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    deleted_at: null,
    overrides: [],
    ...overrides,
  }
}

export function createExternalAgentDetail(
  overrides: Partial<ExternalAgentDetailResponse> = {},
): ExternalAgentDetailResponse {
  return {
    asset: createExternalAgentAsset(),
    connection: {
      revision_id: '33333333-3333-4333-8333-333333333333',
      endpoint: 'https://agents.example.test/contract',
      interface_url: 'https://agents.example.test/contract',
      auth_type: 'bearer',
      has_credential: true,
      auth_check: 'verified',
      verified_at: '2026-11-01T12:00:00Z',
      profile: 'a2a_v1',
      capabilities: { traceability_supported: true },
      card: {
        name: 'Contract Review Agent',
        description: 'Reviews contracts.',
        version: '1.0.0',
        provider: { organization: 'Example Agent Services' },
        documentationUrl: 'https://agents.example.test/docs',
        defaultInputModes: ['text/plain', 'application/pdf'],
        defaultOutputModes: ['text/plain', 'application/json'],
        supportedInterfaces: [{ protocolVersion: '1.0', transport: 'HTTP+JSON' }],
        skills: [
          {
            id: 'contract-review',
            name: 'Contract review',
            description: 'Find risky terms in a contract.',
            tags: ['Legal'],
            examples: ['Review this contract and identify clauses that may expose us to risk.'],
          },
          {
            id: 'policy-check',
            name: 'Policy check',
            description: 'Check a contract against company policy.',
            tags: ['Compliance'],
            examples: ['Compare this contract with our procurement policy.'],
          },
        ],
      },
    },
    ...overrides,
  }
}

export function createExternalAgentCapabilities(
  overrides: Partial<ExternalAgentCapabilitiesResponse> = {},
): ExternalAgentCapabilitiesResponse {
  return {
    enabled: true,
    protocol: 'a2a/1.0',
    transport: 'HTTP+JSON',
    authentication: ['none', 'bearer'],
    input_file_modes: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg'],
    limits: {
      logical_budget_seconds: 3600,
      files: {
        max_files: 5,
        max_document_bytes: 15 * 1024 * 1024,
        max_image_bytes: 10 * 1024 * 1024,
        max_total_bytes: 30 * 1024 * 1024,
      },
    },
    ...overrides,
  }
}

export function createExternalAgentReferences(
  overrides: Partial<ExternalAgentReferencesResponse> = {},
): ExternalAgentReferencesResponse {
  return { apps: [], may_have_in_flight: false, ...overrides }
}
