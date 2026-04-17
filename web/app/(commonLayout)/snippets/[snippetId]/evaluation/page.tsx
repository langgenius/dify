import SnippetEvaluationPage from '@/app/components/snippets/snippet-evaluation-page'

const Page = async (props: {
  params: Promise<{ snippetId: string }>
}) => {
  const { snippetId } = await props.params

  return <SnippetEvaluationPage snippetId={snippetId} />
}

export default Page
