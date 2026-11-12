import type {
  ExternalAgentOperationResponse,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { asRecord } from '@/features/agent-v2/external-agent/model'
import { createExternalAgentDetail } from '@/test/console/external-agents'

export function createExternalVerification(
  overrides: Partial<ExternalAgentVerificationResponse> = {},
): ExternalAgentVerificationResponse {
  const detail = createExternalAgentDetail()
  return {
    verification_id: '55555555-5555-4555-8555-555555555555',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    auth_check: 'not_exercised',
    interface_url: 'https://agents.example.test/contract',
    card: asRecord(detail.connection.card),
    capabilities: { streaming: true, traceability_supported: true },
    warnings: { technical: [], business: [] },
    ...overrides,
  }
}

export function createExternalOperation(
  overrides: Partial<ExternalAgentOperationResponse> = {},
): ExternalAgentOperationResponse {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    resource_id: createExternalAgentDetail().asset.id,
    kind: 'create',
    result: { changed: true, test_display_generation: 1 },
    ...overrides,
  }
}
