import type { BasicPlan, UsagePlanInfo } from '../../type'
import type { PlanRange } from '../plan-switcher/plan-range-switcher'
import Divider from '@/app/components/base/divider'
import { Plan, SelfHostedPlan } from '../../type'
import CloudPlanItem from './cloud-plan-item'
import SelfHostedPlanItem from './self-hosted-plan-item'

type PlansProps = {
  plan: {
    type: Plan
    usage: UsagePlanInfo
    total: UsagePlanInfo
  }
  currentPlan: string
  planRange: PlanRange
  canPay: boolean
}

const Plans = ({
  plan,
  currentPlan,
  planRange,
  canPay,
}: PlansProps) => {
  const currentPlanType: BasicPlan = plan.type === Plan.enterprise ? Plan.team : plan.type
  return (
    <div className="flex w-full justify-center border-t border-divider-accent px-10">
      <div className="flex max-w-[1680px] grow border-x border-divider-accent">
        {
          currentPlan === 'cloud' && (
            <>
              <CloudPlanItem
                currentPlan={currentPlanType}
                plan={Plan.sandbox}
                planRange={planRange}
                canPay={canPay}
              />
              <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
              <CloudPlanItem
                currentPlan={currentPlanType}
                plan={Plan.professional}
                planRange={planRange}
                canPay={canPay}
              />
              <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
              <CloudPlanItem
                currentPlan={currentPlanType}
                plan={Plan.team}
                planRange={planRange}
                canPay={canPay}
              />
            </>
          )
        }
        {
          currentPlan === 'self' && (
            <>
              <SelfHostedPlanItem
                plan={SelfHostedPlan.community}
              />
              <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
              <SelfHostedPlanItem
                plan={SelfHostedPlan.premium}
              />
              <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
              <SelfHostedPlanItem
                plan={SelfHostedPlan.enterprise}
              />
            </>
          )
        }
      </div>
    </div>
  )
}

export default Plans
