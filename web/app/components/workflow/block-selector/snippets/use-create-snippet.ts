import type { CreateSnippetDialogPayload } from '../../create-snippet-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
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
    icon,
    graph,
  }: CreateSnippetDialogPayload) => {
    setIsCreatingSnippet(true)

    try {
      const snippet = await createSnippetMutation.mutateAsync({
        body: {
          name,
          description: description || undefined,
          icon_info: {
            icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
            icon_type: icon.type,
            icon_background: icon.type === 'emoji' ? icon.background : undefined,
            icon_url: icon.type === 'image' ? icon.url : undefined,
          },
        },
      })

      await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId: snippet.id },
        body: { graph },
      })

      toast.success(t('snippet.createSuccess', { ns: 'workflow' }))
      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('createFailed', { ns: 'snippet' }))
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
