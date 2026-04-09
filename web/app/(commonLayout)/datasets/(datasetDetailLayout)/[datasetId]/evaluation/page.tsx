import Evaluation from '@/app/components/evaluation'

const Page = async (props: {
  params: Promise<{ datasetId: string }>
}) => {
  const { datasetId } = await props.params

  return <Evaluation resourceType="datasets" resourceId={datasetId} />
}

export default Page
