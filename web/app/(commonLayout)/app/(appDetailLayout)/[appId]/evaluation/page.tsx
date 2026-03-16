import Evaluation from '@/app/components/evaluation'

const Page = async (props: {
  params: Promise<{ appId: string }>
}) => {
  const { appId } = await props.params

  return <Evaluation resourceType="workflow" resourceId={appId} />
}

export default Page
