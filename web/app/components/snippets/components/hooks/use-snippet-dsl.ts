import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportSnippetMutation } from '@/service/use-snippets'
import { downloadBlob } from '@/utils/download'

type UseSnippetDSLOptions = {
  snippetId: string
  snippetName: string
}

export const useSnippetDSL = ({ snippetId, snippetName }: UseSnippetDSLOptions) => {
  const { t } = useTranslation(['snippet'])
  const exportSnippetMutation = useExportSnippetMutation({
    meta: { errorMessage: t(($) => $.exportFailed) },
  })

  const handleExportDSL = useCallback(
    async (include = false, workflowId?: string) => {
      try {
        const data = await exportSnippetMutation.mutateAsync({
          snippetId,
          include,
          workflowId,
        })
        const file = new Blob([data], { type: 'application/yaml' })
        downloadBlob({ data: file, fileName: `${snippetName}.yml` })
      } catch {
        // The export mutation reports its failure.
      }
    },
    [exportSnippetMutation, snippetId, snippetName],
  )

  return { handleExportDSL }
}
