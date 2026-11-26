import EvaluationPlanGuard from '@/app/components/billing/evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'

const Page = async (props: { params: Promise<{ datasetId: string }> }) => {
  const { datasetId } = await props.params

  return (
    <EvaluationPlanGuard fallbackHref={`/datasets/${datasetId}/documents`} resourceType="datasets">
      <Evaluation resourceType="datasets" resourceId={datasetId} />
    </EvaluationPlanGuard>
  )
}

export default Page
