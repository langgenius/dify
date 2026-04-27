import DeployTab from '@/app/components/deployments/instance-detail/deploy-tab'

type PageProps = {
  params: Promise<{ instanceId: string }>
}

const InstanceDetailDeployPage = async ({ params }: PageProps) => {
  const { instanceId } = await params
  return <DeployTab instanceId={instanceId} />
}

export default InstanceDetailDeployPage
