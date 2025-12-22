import React from 'react'
import { render, screen } from '@testing-library/react'
import List from './index'
import { SelfHostedPlan } from '@/app/components/billing/type'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.returnObjects)
        return ['Feature A', 'Feature B']
      return key
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

describe('SelfHostedPlanItem/List', () => {
  test('should render plan info', () => {
    render(<List plan={SelfHostedPlan.community} />)

    expect(screen.getByText('billing.plans.community.includesTitle')).toBeInTheDocument()
    expect(screen.getByText('Feature A')).toBeInTheDocument()
    expect(screen.getByText('Feature B')).toBeInTheDocument()
  })
})
