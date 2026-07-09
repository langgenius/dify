import type { CreateSnippetDialogPayload } from '@/app/components/snippets/create-snippet-dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/app-context-state'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { useCreateSnippetMutation } from '@/service/use-snippets'
import { canCreateAndModifySnippets } from '../utils/permission'

export const useCreateSnippet = () => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const createSnippetMutation = useCreateSnippetMutation()
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)

  const handleOpenCreateSnippetDialog = () => {
    if (!canCreateAndModifySnippet)
      return

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
    if (!canCreateAndModifySnippet)
      return

    setIsCreatingSnippet(true)

    try {
      const createPayload = {
        name,
        description,
        graph,
        input_fields,
      }
      const snippet = await createSnippetMutation.mutateAsync({
        body: createPayload,
      })
      await consoleClient.snippets.bySnippetId.workflows.draft.post({
        params: { snippet_id: snippet.id },
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
    canCreateAndModifySnippet,
    createSnippetMutation,
    handleCloseCreateSnippetDialog,
    handleCreateSnippet,
    handleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen,
    isCreatingSnippet,
  }
}
