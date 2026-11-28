import type { CreateSnippetDialogPayload } from '@/app/components/snippets/create-snippet-dialog'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { canCreateAndModifySnippets } from '../utils/permission'

export const useCreateSnippet = () => {
  const { push } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const createSnippetMutation = useMutation(
    consoleQuery.workspaces.current.customizedSnippets.post.mutationOptions(),
  )
  const { mutateAsync: saveInitialDraft } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.draft.post.mutationOptions(),
  )
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)

  const handleOpenCreateSnippetDialog = () => {
    if (!canCreateAndModifySnippet) return

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
    if (!canCreateAndModifySnippet) return

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
      await saveInitialDraft({
        params: { snippet_id: snippet.id },
        body: {
          graph: createPayload.graph,
          input_fields: createPayload.input_fields,
        },
      })

      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    } catch {
      // The API client surfaces the response message. Avoid showing a second generic create-failed toast here.
    } finally {
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
