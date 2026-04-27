import { redirect } from '@/next/navigation'

type PageProps = {
  params: Promise<{ instanceId: string }>
}

const InstanceDetailPage = async ({ params }: PageProps) => {
  const { instanceId } = await params
  redirect(`/deployments/${instanceId}/overview`)
}

export default InstanceDetailPage
