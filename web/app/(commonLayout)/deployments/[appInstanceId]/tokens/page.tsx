import { DeveloperApiTab } from '@/features/deployments/detail/developer-api-tab'

export default async function InstanceDetailTokensPage({ params }: {
  params: Promise<{ appInstanceId: string }>
}) {
  const { appInstanceId } = await params
  return <DeveloperApiTab appInstanceId={appInstanceId} />
}
