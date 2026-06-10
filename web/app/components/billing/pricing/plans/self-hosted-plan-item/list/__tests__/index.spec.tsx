import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { SelfHostedPlan } from '@/app/components/billing/type'
import { createReactI18nextMock } from '@/test/i18n-mock'
import List from '../index'

// Override global i18n mock to support returnObjects: true for feature arrays
vi.mock('react-i18next', () => createReactI18nextMock({
  'billing.plans.community.features': ['Feature A', 'Feature B'],
}))

describe('SelfHostedPlanItem/List', () => {
  it('should render plan info', () => {
    render(<List plan={SelfHostedPlan.community} />)

    expect(screen.getByText('plans.community.includesTitle')).toBeInTheDocument()
    expect(screen.getByText('Feature A')).toBeInTheDocument()
    expect(screen.getByText('Feature B')).toBeInTheDocument()
  })
})
