import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { UsagePlanInfo } from '../../type'
import type { PlanRange } from '../plan-switcher/plan-range-switcher'
import Divider from '@/app/components/base/divider'
import CloudPlanItem from './cloud-plan-item'
import SelfHostedPlanItem from './self-hosted-plan-item'

type PlansProps = {
  plan: {
    type: CloudPlan
    usage: UsagePlanInfo
    total: UsagePlanInfo
  }
  currentPlan: string
  planRange: PlanRange
  canPay: boolean
}

const Plans = ({ plan, currentPlan, planRange, canPay }: PlansProps) => {
  const currentPlanType = plan.type
  return (
    <div className="flex w-full justify-center border-t border-divider-accent px-10">
      <div className="flex max-w-[1680px] grow border-x border-divider-accent">
        {currentPlan === 'cloud' && (
          <>
            <CloudPlanItem
              currentPlan={currentPlanType}
              plan="sandbox"
              planRange={planRange}
              canPay={canPay}
            />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <CloudPlanItem
              currentPlan={currentPlanType}
              plan="professional"
              planRange={planRange}
              canPay={canPay}
            />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <CloudPlanItem
              currentPlan={currentPlanType}
              plan="team"
              planRange={planRange}
              canPay={canPay}
            />
          </>
        )}
        {currentPlan === 'self' && (
          <>
            <SelfHostedPlanItem plan="community" />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <SelfHostedPlanItem plan="premium" />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <SelfHostedPlanItem plan="enterprise" />
          </>
        )}
      </div>
    </div>
  )
}

export default Plans
