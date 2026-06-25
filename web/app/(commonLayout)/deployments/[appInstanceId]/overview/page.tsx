import { OverviewTab } from '@/features/deployments/detail/overview-tab'

export default async function InstanceDetailOverviewPage({ params }: {
  params: Promise<{ appInstanceId: string }>
}) {
  const { appInstanceId } = await params
  return <OverviewTab appInstanceId={appInstanceId} />
}
