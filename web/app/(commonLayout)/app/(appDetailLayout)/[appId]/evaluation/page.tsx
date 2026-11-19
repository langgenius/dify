import EvaluationPlanGuard from '@/app/components/billing/evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'

const Page = async (props: { params: Promise<{ appId: string }> }) => {
  const { appId } = await props.params

  return (
    <EvaluationPlanGuard fallbackHref={`/app/${appId}/overview`}>
      <Evaluation resourceType="apps" resourceId={appId} />
    </EvaluationPlanGuard>
  )
}

export default Page
