import type { MockedFunction } from 'vitest'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Button from './button'
import { SelfHostedPlan } from '../../../type'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

vi.mock('@/hooks/use-theme')

const mockUseTheme = useTheme as MockedFunction<typeof useTheme>

beforeEach(() => {
  vi.clearAllMocks()
  mockUseTheme.mockReturnValue({ theme: Theme.light } as unknown as ReturnType<typeof useTheme>)
})

describe('SelfHostedPlanButton', () => {
  test('should invoke handler when clicked', () => {
    const handleGetPayUrl = vi.fn()
    render(
      <Button
        plan={SelfHostedPlan.community}
        handleGetPayUrl={handleGetPayUrl}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'billing.plans.community.btnText' }))
    expect(handleGetPayUrl).toHaveBeenCalledTimes(1)
  })

  test.each([
    { label: 'light', theme: Theme.light },
    { label: 'dark', theme: Theme.dark },
  ])('should render premium button label when theme is $label', ({ theme }) => {
    mockUseTheme.mockReturnValue({ theme } as unknown as ReturnType<typeof useTheme>)

    render(
      <Button
        plan={SelfHostedPlan.premium}
        handleGetPayUrl={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'billing.plans.premium.btnText' })).toBeInTheDocument()
  })
})
