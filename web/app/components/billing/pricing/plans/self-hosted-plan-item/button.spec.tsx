import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Button from './button'
import { SelfHostedPlan } from '../../../type'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

jest.mock('@/hooks/use-theme')

jest.mock('@/app/components/base/icons/src/public/billing', () => ({
  AwsMarketplaceLight: () => <div>AwsMarketplaceLight</div>,
  AwsMarketplaceDark: () => <div>AwsMarketplaceDark</div>,
}))

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>

beforeEach(() => {
  jest.clearAllMocks()
  mockUseTheme.mockReturnValue({ theme: Theme.light } as unknown as ReturnType<typeof useTheme>)
})

describe('SelfHostedPlanButton', () => {
  test('should invoke handler when clicked', () => {
    const handleGetPayUrl = jest.fn()
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
    const handleGetPayUrl = jest.fn()

    render(
      <Button
        plan={SelfHostedPlan.premium}
        handleGetPayUrl={handleGetPayUrl}
      />,
    )

    expect(screen.getByText('AwsMarketplaceLight')).toBeInTheDocument()
  })

  test('should switch to dark AWS badge in dark theme', () => {
    mockUseTheme.mockReturnValue({ theme: Theme.dark } as unknown as ReturnType<typeof useTheme>)

    render(
      <Button
        plan={SelfHostedPlan.premium}
        handleGetPayUrl={jest.fn()}
      />,
    )

    expect(screen.getByText('AwsMarketplaceDark')).toBeInTheDocument()
  })
})
