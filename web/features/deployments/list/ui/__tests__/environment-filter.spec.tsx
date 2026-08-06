import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { EnvironmentFilter } from '../environment-filter'

vi.mock('../../state', async () => {
  const { atom } = await import('jotai')
  const { parseAsString } = await import('nuqs')
  const allOption = { kind: 'all' as const, value: null }

  return {
    deploymentsListEnvironmentFilterOptionsAtom: atom([allOption]),
    deploymentsListSelectedEnvironmentFilterOptionAtom: atom(allOption),
    envFilterQueryState: parseAsString.withOptions({ history: 'push' }),
  }
})

describe('EnvironmentFilter', () => {
  it('should keep trigger open state, shadow variant, and arrow DOM in sync', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<EnvironmentFilter />)

    const trigger = screen.getByRole('button', { name: 'deployments.filter.allEnvs' })
    const arrow = trigger.querySelector('.i-ri-arrow-down-s-line')
    expect(trigger).not.toHaveAttribute('data-popup-open')
    expect(trigger).toHaveClass('data-popup-open:shadow-xs')
    expect(arrow).not.toHaveClass('rotate-180')

    await user.click(trigger)

    expect(trigger).toHaveAttribute('data-popup-open')
    expect(arrow).toHaveClass('rotate-180')

    await user.click(trigger)

    expect(trigger).not.toHaveAttribute('data-popup-open')
    expect(arrow).not.toHaveClass('rotate-180')
  })
})
