import { useSnippetDetail } from '@/service/use-snippets'

export const useSnippetInit = (snippetId: string) => {
  return useSnippetDetail(snippetId)
}
