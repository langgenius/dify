import { redirect } from '@/next/navigation'

type PageProps = {
  params: Promise<{ agentId: string }>
}

export default async function Page({
  params,
}: PageProps) {
  const { agentId } = await params

  redirect(`/roster/agent/${agentId}/configure`)
}
