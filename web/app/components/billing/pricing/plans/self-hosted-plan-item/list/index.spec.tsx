import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { SelfHostedPlan } from '@/app/components/billing/type'
import List from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.returnObjects)
        return ['Feature A', 'Feature B']
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
  Trans: ({ i18nKey, ns }: { i18nKey: string, ns?: string }) => <span>{ns ? `${ns}.${i18nKey}` : i18nKey}</span>,
}))

describe('SelfHostedPlanItem/List', () => {
  it('should render plan info', () => {
    render(<List plan={SelfHostedPlan.community} />)

    expect(screen.getByText('billing.plans.community.includesTitle')).toBeInTheDocument()
    expect(screen.getByText('Feature A')).toBeInTheDocument()
    expect(screen.getByText('Feature B')).toBeInTheDocument()
  })
})
