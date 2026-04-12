import SnippetAndEvaluationPlanGuard from '@/app/components/billing/snippet-and-evaluation-plan-guard'
import Evaluation from '@/app/components/evaluation'

const Page = async (props: {
  params: Promise<{ datasetId: string }>
}) => {
  const { datasetId } = await props.params

  return (
    <SnippetAndEvaluationPlanGuard fallbackHref={`/datasets/${datasetId}/documents`}>
      <Evaluation resourceType="datasets" resourceId={datasetId} />
    </SnippetAndEvaluationPlanGuard>
  )
}

export default Page
