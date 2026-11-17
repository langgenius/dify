import type { ExternalAgentOperationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { MutationObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'

const request = vi.hoisted(() => vi.fn<() => Promise<Response>>())
// boundary: replace Console HTTP responses while preserving generated mutation options and cache policies.
vi.mock('@/service/base', () => ({ request }))

it.each(['success', 'lost response'] as const)(
  'invalidates only the edited Agent capabilities after connection Save %s',
  async (result) => {
    onTestFinished(guardUnexpectedFetch())
    const client = createTestQueryClient()
    onTestFinished(() => client.clear())
    const agentId = '22222222-2222-4222-8222-222222222222'
    const capabilityKeys = {
      edited: consoleQuery.externalAgents.capabilities.get.queryKey({
        input: { query: { agent_id: agentId } },
      }),
      other: consoleQuery.externalAgents.capabilities.get.queryKey({
        input: { query: { agent_id: '44444444-4444-4444-8444-444444444444' } },
      }),
      global: consoleQuery.externalAgents.capabilities.get.queryKey(),
    }
    for (const key of Object.values(capabilityKeys))
      client.setQueryData(key, createExternalAgentCapabilities())
    const operation: ExternalAgentOperationResponse = {
      id: '66666666-6666-4666-8666-666666666666',
      resource_id: agentId,
      kind: 'connection',
      result: { changed: true, test_display_generation: 2 },
    }
    request.mockReset()
    if (result === 'success') request.mockResolvedValue(Response.json(operation))
    else request.mockRejectedValue(new TypeError('Connection lost'))
    const mutation = new MutationObserver(
      client,
      consoleQuery.externalAgents.byAgentId.connection.put.mutationOptions(),
    )
    const save = mutation.mutate({
      params: { agent_id: agentId },
      body: {
        verification_id: '55555555-5555-4555-8555-555555555555',
        expected_revision_id: '33333333-3333-4333-8333-333333333333',
        idempotency_key: 'connection-save',
      },
    })
    if (result === 'success') await expect(save).resolves.toEqual(operation)
    else await expect(save).rejects.toThrow('Connection lost')
    expect(client.getQueryState(capabilityKeys.edited)?.isInvalidated).toBe(true)
    expect(client.getQueryState(capabilityKeys.other)?.isInvalidated).toBe(false)
    expect(client.getQueryState(capabilityKeys.global)?.isInvalidated).toBe(false)
  },
)
