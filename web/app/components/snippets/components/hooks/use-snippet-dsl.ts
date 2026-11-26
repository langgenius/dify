import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'

type UseSnippetDSLOptions = {
  snippetId: string
  snippetName: string
}

export const useSnippetDSL = ({ snippetId, snippetName }: UseSnippetDSLOptions) => {
  const { t } = useTranslation(['snippet'])
  const { mutateAsync: exportSnippet } = useMutation(
    consoleQuery.workspaces.current.customizedSnippets.bySnippetId.export.get.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const handleExportDSL = useCallback(
    async (include = false, workflowId?: string) => {
      try {
        const data = await exportSnippet({
          params: { snippet_id: snippetId },
          query: {
            include_secret: include ? 'true' : 'false',
            workflow_id: workflowId,
          },
        })
        const file = new Blob([data], { type: 'application/yaml' })
        downloadBlob({ data: file, fileName: `${snippetName}.yml` })
      } catch (error) {
        toast.error(getErrorMessage(error) ?? t(($) => $.exportFailed))
      }
    },
    [exportSnippet, snippetId, snippetName, t],
  )

  return { handleExportDSL }
}
