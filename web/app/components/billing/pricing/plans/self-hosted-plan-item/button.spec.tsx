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

  test('should render AWS marketplace badge for premium plan in light theme', () => {
    const handleGetPayUrl = vi.fn()

    const { container } = render(
      <Button
        plan={SelfHostedPlan.premium}
        handleGetPayUrl={handleGetPayUrl}
      />,
    )

    expect(container.querySelector('[data-icon="AwsMarketplaceLight"]')).toBeInTheDocument()
  })

  test('should switch to dark AWS badge in dark theme', () => {
    mockUseTheme.mockReturnValue({ theme: Theme.dark } as unknown as ReturnType<typeof useTheme>)

    const { container } = render(
      <Button
        plan={SelfHostedPlan.premium}
        handleGetPayUrl={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-icon="AwsMarketplaceDark"]')).toBeInTheDocument()
  })
})
