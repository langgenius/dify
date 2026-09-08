import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import { renderWithNuqs } from '@/test/nuqs-testing'
import Header from '../header'
import { Pricing } from '../index'
import { pricingQueryParamName, pricingQueryParser } from '../query-params'

vi.mock('@/context/i18n', () => ({ useLocale: () => 'en-US' }))
vi.mock('../content', () => ({
  PricingContent: () => (
    <>
      <Header />
      <p>Plans loaded</p>
    </>
  ),
}))

function PricingEntry() {
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  return <button onClick={() => setPricing('open')}>Upgrade</button>
}

describe('Pricing URL dialog', () => {
  it.each(['', '?pricing=closed'])('stays closed for %s', (searchParams) => {
    renderWithNuqs(<Pricing />, { searchParams })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Plans loaded')).not.toBeInTheDocument()
  })

  it('opens from another owner and clears only its parameter when closed', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(
      <>
        <PricingEntry />
        <Pricing />
      </>,
      { searchParams: '?settings=billing' },
    )
    await user.click(screen.getByRole('button', { name: 'Upgrade' }))
    const dialog = await screen.findByRole('dialog', { name: 'billing.plansCommon.title.plans' })
    await screen.findByText('Plans loaded')
    expect(screen.getByRole('heading', { name: 'billing.plansCommon.title.plans' })).toBeVisible()
    expect(dialog).toHaveAccessibleDescription('billing.plansCommon.title.description')
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument()
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
    expect(onUrlUpdate.mock.lastCall?.[0].options.history).toBe('replace')

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('pricing')).toBe(false)
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('billing')
    expect(onUrlUpdate.mock.lastCall?.[0].options.history).toBe('replace')
  })

  it('opens directly from the URL and closes with Escape', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<Pricing />, { searchParams: '?pricing=open' })
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('pricing')).toBe(false)
  })
})
