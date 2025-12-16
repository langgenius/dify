import React from 'react'
import { render, screen } from '@testing-library/react'
import List from './index'
import { Plan } from '../../../../type'

describe('CloudPlanItem/List', () => {
  test('should show sandbox specific quotas', () => {
    render(<List plan={Plan.sandbox} />)

    expect(screen.getByText('billing.plansCommon.messageRequest.title:{"count":200}')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.triggerEvents.sandbox:{"count":3000}')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.startNodes.limited:{"count":2}')).toBeInTheDocument()
  })

  test('should show professional monthly quotas and tooltips', () => {
    render(<List plan={Plan.professional} />)

    expect(screen.getByText('billing.plansCommon.messageRequest.titlePerMonth:{"count":5000}')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.vectorSpaceTooltip')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.workflowExecution.faster')).toBeInTheDocument()
  })

  test('should show unlimited messaging details for team plan', () => {
    render(<List plan={Plan.team} />)

    expect(screen.getByText('billing.plansCommon.triggerEvents.unlimited')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.workflowExecution.priority')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.unlimitedApiRate')).toBeInTheDocument()
  })
})
