import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import {
  createModelCreditsFixture,
  createTokenerCreditsFixture,
} from '@/test/console/model-billing'
import {
  createProviderSummaryFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ProviderAddedCard from '../index'

const { getCredits, changePriority } = vi.hoisted(() => ({
  getCredits: vi.fn(),
  changePriority: vi.fn().mockResolvedValue({ result: 'success' }),
}))

// boundary: only server responses are replaced; the provider card, credential state and controls stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.credits.get': getCredits,
      'workspaces.current.modelProviders.byProvider.preferredProviderType.post': changePriority,
    }),
  }
})

it('updates a real provider card from processing to active credits without exhaustion or an automatic personal-key fallback', async () => {
  const provider = createProviderSummaryFixture({
    provider: 'langgenius/openai/openai',
    preferred_provider_type: 'system',
    system_configuration: { enabled: true },
    icon_small: { en_US: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
  })
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    features: {},
    systemFeatures: { rbac_enabled: false, deployment_edition: 'CLOUD' },
    trialModels: [provider.provider],
    workspacePermissionKeys: ['credential.use', 'credential.manage'],
  })
  seedModelProviderQueries(queryClient)
  const queryKey = consoleQuery.workspaces.current.modelProviders.credits.get.queryKey()
  queryClient.setQueryData(
    queryKey,
    createModelCreditsFixture({
      model_billing_migration_status: 'processing',
      quota_limit: null,
      quota_used: null,
      remaining_credits: null,
      is_exhausted: false,
    }),
  )
  getCredits.mockReset().mockResolvedValue(createTokenerCreditsFixture())
  changePriority.mockClear()
  const screen = await render(
    <NuqsTestingAdapter>
      <Wrapper>
        <ProviderAddedCard provider={provider} />
        <button
          type="button"
          onClick={async () => {
            await queryClient.invalidateQueries({ queryKey })
          }}
        >
          Refresh credits
        </button>
      </Wrapper>
    </NuqsTestingAdapter>,
  )
  await expect.element(screen.getByRole('status')).toMatchTextContent(/tokenerProcessing/)
  await expect.element(screen.getByText(/quotaExhausted/)).not.toBeInTheDocument()
  expect(changePriority).not.toHaveBeenCalled()

  await screen.getByRole('button', { name: 'Refresh credits' }).click()
  await expect.element(screen.getByText(/aiCreditsInUse/)).toBeVisible()
  await expect.element(screen.getByText(/tokenerProcessing/)).not.toBeInTheDocument()
  await expect.element(screen.getByText(/quotaExhausted/)).not.toBeInTheDocument()
  expect(getCredits).toHaveBeenCalledOnce()
  expect(changePriority).not.toHaveBeenCalled()
})
