import SnippetPage from '@/app/components/snippets'

const Page = async (props: {
  params: Promise<{ snippetId: string }>
}) => {
  const { snippetId } = await props.params

  return <SnippetPage snippetId={snippetId} section="orchestrate" />
}

export default Page
