import type { ComponentProps } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import { createConsoleQueryWrapper, createFeaturesFixture } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { TokenerAllowanceDetails } from '../tokener-allowance-details'

vi.unmock('react-i18next')

type DetailsProps = ComponentProps<typeof TokenerAllowanceDetails>
type PlanAllowance = NonNullable<DetailsProps['planAllowance']>

const fake = setupFakeApi(() => ({
  console: {
    features: {
      get: () => createFeaturesFixture({ billing: { subscription: { plan: 'professional' } } }),
    },
  },
}))

function makePlanAllowance(overrides: Partial<PlanAllowance> = {}): PlanAllowance {
  return {
    plan: 'paid',
    amount_usd_micro: '11150900',
    available_usd_micro: '11150900',
    starts_at: '2026-11-27T00:00:00Z',
    ends_at: '2026-12-27T00:00:00Z',
    ...overrides,
  }
}

async function setup(props: DetailsProps) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { modelProvider } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({ features: null })
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <TokenerAllowanceDetails {...props} />
      </I18nextProvider>
    </Providers>,
  )
}

it.each([
  {
    billingPlan: 'professional',
    label: 'Pro plan credits',
    amountMicro: '11150900',
    credits: '5,000 / 5,000 Credits',
  },
  {
    billingPlan: 'team',
    label: 'Team plan credits',
    amountMicro: '22301800',
    credits: '10,000 / 10,000 Credits',
  },
] as const)(
  'shows $label and purchased balance by default without a disclosure',
  async (testCase) => {
    fake.console.features.get.mockResolvedValue(
      createFeaturesFixture({ billing: { subscription: { plan: testCase.billingPlan } } }),
    )
    const screen = await setup({
      planAllowance: makePlanAllowance({
        amount_usd_micro: testCase.amountMicro,
        available_usd_micro: testCase.amountMicro,
      }),
      purchasedAvailableUsdMicro: '1000000',
    })

    const title = screen.getByText('Balance details')
    await expect.element(title).toBeVisible()
    expect(title.all()).toHaveLength(1)
    await expect
      .element(screen.getByRole('button', { name: 'Balance details' }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText(testCase.label)).toBeVisible()
    await expect.element(screen.getByText(testCase.credits)).toBeVisible()
    await expect.element(screen.getByText('Purchased balance')).toBeVisible()
    await expect.element(screen.getByText('USD 1.00')).toBeVisible()
    expect(fake.console.features.get).toHaveBeenCalledTimes(1)
  },
)

it('shows a genuinely exhausted paid plan without inventing a missing purchased balance', async () => {
  const screen = await setup({
    planAllowance: makePlanAllowance({ available_usd_micro: '0' }),
    purchasedAvailableUsdMicro: null,
  })

  await expect.element(screen.getByText('Pro plan credits')).toBeVisible()
  await expect.element(screen.getByText('0 / 5,000 Credits')).toBeVisible()
  await expect.element(screen.getByText('Purchased balance')).not.toBeInTheDocument()
  await expect.element(screen.getByText('USD 0.00')).not.toBeInTheDocument()
})

it.each([
  { remainingMicro: '2230', displayed: 'Less than 1 / 200 Credits' },
  { remainingMicro: '2231', displayed: '1 / 200 Credits' },
])(
  'formats $remainingMicro microdollars on the correct side of one Sandbox credit',
  async (testCase) => {
    const screen = await setup({
      planAllowance: makePlanAllowance({
        plan: 'sandbox',
        amount_usd_micro: '446036',
        available_usd_micro: testCase.remainingMicro,
        ends_at: null,
      }),
      purchasedAvailableUsdMicro: '0',
    })

    await expect.element(screen.getByText('Sandbox plan credits')).toBeVisible()
    await expect.element(screen.getByText(testCase.displayed)).toBeVisible()
    await expect.element(screen.getByText('Purchased balance')).toBeVisible()
    await expect.element(screen.getByText('USD 0.00')).toBeVisible()
    expect(fake.console.features.get).not.toHaveBeenCalled()
  },
)
