import { AccessTab } from '@/features/deployments/detail/access-tab'

export default async function InstanceDetailAccessPage({ params }: {
  params: Promise<{ appInstanceId: string }>
}) {
  const { appInstanceId } = await params
  return <AccessTab appInstanceId={appInstanceId} />
}
