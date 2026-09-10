import { redirect } from '@/next/navigation'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params
  redirect(`/datasets/new/${knowledgeSpaceId}/sources`)
}
