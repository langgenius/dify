import SnippetPage from '@/app/components/snippets'

const Page = async (props: {
  params: Promise<{ snippetId: string }>
}) => {
  const { params } = props

  return <SnippetPage snippetId={(await params).snippetId} />
}

export default Page
