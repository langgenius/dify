'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSnippetDialog from '@/app/components/snippets/create-snippet-dialog'
import { useRouter } from '@/next/navigation'
import {
  useCreateSnippetMutation,
} from '@/service/use-snippets'

const SnippetCreateButton = () => {
  const { t } = useTranslation('snippet')
  const { push } = useRouter()
  const createSnippetMutation = useCreateSnippetMutation()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const handleCreateSnippet = ({
    name,
    description,
  }: {
    name: string
    description: string
  }) => {
    createSnippetMutation.mutate({
      body: {
        name,
        description: description || undefined,
      },
    }, {
      onSuccess: (snippet) => {
        toast.success(t('snippet.createSuccess', { ns: 'workflow' }))
        setIsCreateDialogOpen(false)
        push(`/snippets/${snippet.id}/orchestrate`)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('createFailed'))
      },
    })
  }

  return (
    <>
      <Button
        variant="primary"
        disabled={createSnippetMutation.isPending}
        onClick={() => setIsCreateDialogOpen(true)}
      >
        <span aria-hidden className="mr-0.5 i-ri-add-line size-4" />
        <span>{t('create')}</span>
      </Button>

      {isCreateDialogOpen && (
        <CreateSnippetDialog
          isOpen={isCreateDialogOpen}
          isSubmitting={createSnippetMutation.isPending}
          onClose={() => setIsCreateDialogOpen(false)}
          onConfirm={handleCreateSnippet}
        />
      )}
    </>
  )
}

export default SnippetCreateButton
