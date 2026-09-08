import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import { renderWithNuqs } from '@/test/nuqs-testing'
import Header from '../header'
import { Pricing } from '../index'
import { pricingQueryParamName, pricingQueryParser } from '../query-params'

const dialogModule = vi.hoisted(() => ({ ready: Promise.resolve() }))

vi.mock('../dialog-content', async (importOriginal) => {
  await dialogModule.ready
  return importOriginal()
})

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

function CancelPricing() {
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  return <button onClick={() => setPricing(null)}>Cancel opening</button>
}

describe('Pricing URL dialog', () => {
  it.each(['', '?pricing=closed'])('stays closed for %s', (searchParams) => {
    renderWithNuqs(<Pricing />, { searchParams })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Plans loaded')).not.toBeInTheDocument()
  })

  it('does not open after the URL is cleared while the dialog module loads', async () => {
    const user = userEvent.setup()
    let resolveModule!: () => void
    dialogModule.ready = new Promise<void>((resolve) => {
      resolveModule = resolve
    })
    const { onUrlUpdate } = renderWithNuqs(
      <>
        <PricingEntry />
        <CancelPricing />
        <Pricing />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel opening' }))
    await act(async () => {
      resolveModule()
      await dialogModule.ready
    })
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('pricing')).toBe(false),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel opening' })).toHaveFocus()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade' })).toHaveFocus())
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
