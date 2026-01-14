import type { Mock } from 'vitest'
import type { UsagePlanInfo } from '../../type'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { Plan } from '../../type'
import { PlanRange } from '../plan-switcher/plan-range-switcher'
import cloudPlanItem from './cloud-plan-item'
import Plans from './index'
import selfHostedPlanItem from './self-hosted-plan-item'

vi.mock('./cloud-plan-item', () => ({
  default: vi.fn(props => (
    <div data-testid={`cloud-plan-${props.plan}`} data-current-plan={props.currentPlan}>
      Cloud
      {' '}
      {props.plan}
    </div>
  )),
}))

vi.mock('./self-hosted-plan-item', () => ({
  default: vi.fn(props => (
    <div data-testid={`self-plan-${props.plan}`}>
      Self
      {' '}
      {props.plan}
    </div>
  )),
}))

const buildPlan = (type: Plan) => {
  const usage: UsagePlanInfo = {
    buildApps: 0,
    teamMembers: 0,
    annotatedResponse: 0,
    documentsUploadQuota: 0,
    apiRateLimit: 0,
    triggerEvents: 0,
    vectorSpace: 0,
  }
  return {
    type,
    usage,
    total: usage,
  }
}

describe('Plans', () => {
  // Cloud plans visible only when currentPlan is cloud
  describe('Cloud plan rendering', () => {
    it('should render sandbox, professional, and team cloud plans when workspace is cloud', () => {
      render(
        <Plans
          plan={buildPlan(Plan.enterprise)}
          currentPlan="cloud"
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      expect(screen.getByTestId('cloud-plan-sandbox')).toBeInTheDocument()
      expect(screen.getByTestId('cloud-plan-professional')).toBeInTheDocument()
      expect(screen.getByTestId('cloud-plan-team')).toBeInTheDocument()

      const firstCallProps = (cloudPlanItem as unknown as Mock).mock.calls[0][0]
      expect(firstCallProps.plan).toBe(Plan.sandbox)
      // Enterprise should be normalized to team when passed down
      expect(firstCallProps.currentPlan).toBe(Plan.team)
    })
  })

  // Self-hosted plans visible for self-managed workspaces
  describe('Self-hosted plan rendering', () => {
    it('should render all self-hosted plans when workspace type is self-hosted', () => {
      render(
        <Plans
          plan={buildPlan(Plan.sandbox)}
          currentPlan="self"
          planRange={PlanRange.yearly}
          canPay={false}
        />,
      )

      expect(screen.getByTestId('self-plan-community')).toBeInTheDocument()
      expect(screen.getByTestId('self-plan-premium')).toBeInTheDocument()
      expect(screen.getByTestId('self-plan-enterprise')).toBeInTheDocument()

      expect(selfHostedPlanItem).toHaveBeenCalledTimes(3)
    })
  })
})
