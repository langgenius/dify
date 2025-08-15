import Divider from '@/app/components/base/divider'
import { type BasicPlan, Plan, type UsagePlanInfo } from '../../type'
import PlanItem from './plan-item'
import type { PlanRange } from '../plan-switcher/plan-range-switcher'

type PlansProps = {
  plan: {
    type: BasicPlan
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
  return (
    <div className='flex w-full justify-center border-t border-divider-accent px-10'>
      <div className='flex max-w-[1680px] grow border-x border-divider-accent'>
        {
          currentPlan === 'cloud' && (
            <>
              <PlanItem
                currentPlan={plan.type}
                plan={Plan.sandbox}
                planRange={planRange}
                canPay={canPay}
              />
              <Divider type='vertical' className='mx-0 shrink-0 bg-divider-accent' />
              <PlanItem
                currentPlan={plan.type}
                plan={Plan.professional}
                planRange={planRange}
                canPay={canPay}
              />
              <Divider type='vertical' className='mx-0 shrink-0 bg-divider-accent' />
              <PlanItem
                currentPlan={plan.type}
                plan={Plan.team}
                planRange={planRange}
                canPay={canPay}
              />
            </>
          )
        }
        {
          // currentPlan === 'self' && <>
          //   <SelfHostedPlanItem
          //     plan={SelfHostedPlan.community}
          //     planRange={planRange}
          //     canPay={canPay}
          //   />
          //   <SelfHostedPlanItem
          //     plan={SelfHostedPlan.premium}
          //     planRange={planRange}
          //     canPay={canPay}
          //   />
          //   <SelfHostedPlanItem
          //     plan={SelfHostedPlan.enterprise}
          //     planRange={planRange}
          //     canPay={canPay}
          //   />
          // </>
        }
      </div>
    </div>
  )
}

export default Plans
