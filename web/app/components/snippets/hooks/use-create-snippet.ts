import type { CreateSnippetDialogPayload } from '@/app/components/snippets/create-snippet-dialog'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import { useCreateSnippetMutation } from '@/service/use-snippets'
import { canCreateAndModifySnippets } from '../utils/permission'

export const useCreateSnippet = () => {
  const { push } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const createSnippetMutation = useCreateSnippetMutation()
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)
  const [createError, setCreateError] = useState<unknown>()
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)

  const handleOpenCreateSnippetDialog = () => {
    if (!canCreateAndModifySnippet) return

    setCreateError(undefined)
    setIsCreateSnippetDialogOpen(true)
  }

  const handleCloseCreateSnippetDialog = () => {
    setCreateError(undefined)
    setIsCreateSnippetDialogOpen(false)
  }

  const handleCreateSnippet = async ({
    name,
    description,
    graph,
    input_fields,
  }: CreateSnippetDialogPayload) => {
    if (!canCreateAndModifySnippet) return

    setCreateError(undefined)
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

      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setCreateError(error)
    } finally {
      setIsCreatingSnippet(false)
    }
  }

  return {
    canCreateAndModifySnippet,
    createSnippetMutation,
    createError,
    handleCloseCreateSnippetDialog,
    handleCreateSnippet,
    handleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen,
    isCreatingSnippet,
  }
}
