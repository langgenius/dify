// import { useSnippetDetail } from '@/service/use-snippets'
import { useSnippetDetail } from '@/service/use-snippets.mock'

export const useSnippetInit = (snippetId: string) => {
  return useSnippetDetail(snippetId)
}
