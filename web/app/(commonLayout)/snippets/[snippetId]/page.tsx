import { redirect } from 'next/navigation'

const Page = async (props: {
  params: Promise<{ snippetId: string }>
}) => {
  const { snippetId } = await props.params

  redirect(`/snippets/${snippetId}/orchestrate`)
}

export default Page
