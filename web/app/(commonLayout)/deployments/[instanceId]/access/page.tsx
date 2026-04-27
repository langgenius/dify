import AccessTab from '@/app/components/deployments/instance-detail/access-tab'

type PageProps = {
  params: Promise<{ instanceId: string }>
}

const InstanceDetailAccessPage = async ({ params }: PageProps) => {
  const { instanceId } = await params
  return <AccessTab instanceId={instanceId} />
}

export default InstanceDetailAccessPage
