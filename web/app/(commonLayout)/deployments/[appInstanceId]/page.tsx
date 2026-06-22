import { redirect } from '@/next/navigation'

export default async function InstanceDetailPage({ params }: {
  params: Promise<{ appInstanceId: string }>
}) {
  const { appInstanceId } = await params
  redirect(`/deployments/${appInstanceId}/overview`)
}
