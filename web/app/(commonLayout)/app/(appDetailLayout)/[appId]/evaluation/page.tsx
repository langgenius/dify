import Evaluation from '@/app/components/evaluation'

const Page = async (props: {
  params: Promise<{ appId: string }>
}) => {
  const { appId } = await props.params

  return <Evaluation resourceType="apps" resourceId={appId} />
}

export default Page
