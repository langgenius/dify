import type { CreateSnippetDialogPayload } from '@/app/components/snippets/create-snippet-dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { useCreateSnippetMutation } from '@/service/use-snippets'

export const useCreateSnippet = () => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const createSnippetMutation = useCreateSnippetMutation()
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)

  const handleOpenCreateSnippetDialog = () => {
    setIsCreateSnippetDialogOpen(true)
  }

  const handleCloseCreateSnippetDialog = () => {
    setIsCreateSnippetDialogOpen(false)
  }

  const handleCreateSnippet = async ({
    name,
    description,
    graph,
    input_fields,
  }: CreateSnippetDialogPayload) => {
    setIsCreatingSnippet(true)

    try {
      const createPayload = {
        name,
        description: description || undefined,
        graph,
        input_fields,
      }
      const snippet = await createSnippetMutation.mutateAsync({
        body: createPayload,
      })
      await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId: snippet.id },
        body: {
          graph: createPayload.graph,
          input_fields: createPayload.input_fields,
        },
      })

      toast.success(t('snippet.createSuccess', { ns: 'workflow' }))
      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    }
    catch {
      // The API client surfaces the response message. Avoid showing a second generic create-failed toast here.
    }
    finally {
      setIsCreatingSnippet(false)
    }
  }

  return {
    createSnippetMutation,
    handleCloseCreateSnippetDialog,
    handleCreateSnippet,
    handleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen,
    isCreatingSnippet,
  }
}
