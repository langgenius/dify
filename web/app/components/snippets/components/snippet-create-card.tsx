'use client'

import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@langgenius/dify-ui/toast'
import CreateSnippetDialog from '@/app/components/workflow/create-snippet-dialog'
import { useRouter } from '@/next/navigation'
import {
  useCreateSnippetMutation,
} from '@/service/use-snippets'
import SnippetImportDSLDialog from './snippet-import-dsl-dialog'

const SnippetCreateCard = () => {
  const { t } = useTranslation('snippet')
  const { push } = useRouter()
  const createSnippetMutation = useCreateSnippetMutation()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isImportDSLDialogOpen, setIsImportDSLDialogOpen] = useState(false)

  const handleCreateFromBlank = () => {
    setIsCreateDialogOpen(true)
  }

  const handleImportDSL = () => {
    setIsImportDSLDialogOpen(true)
  }

  const handleCreateSnippet = ({
    name,
    description,
    icon,
  }: {
    name: string
    description: string
    icon: AppIconSelection
  }) => {
    createSnippetMutation.mutate({
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
      <div className="relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg transition-opacity">
        <div className="grow rounded-t-xl p-2">
          <div className="px-6 pb-1 pt-2 text-xs font-medium leading-[18px] text-text-tertiary">{t('create')}</div>
          <button
            type="button"
            className="mb-1 flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={createSnippetMutation.isPending}
            onClick={handleCreateFromBlank}
          >
            <span aria-hidden className="i-ri-sticky-note-add-line mr-2 h-4 w-4 shrink-0" />
            {t('createFromBlank')}
          </button>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            onClick={handleImportDSL}
          >
            <span aria-hidden className="i-ri-file-upload-line mr-2 h-4 w-4 shrink-0" />
            {t('importDSL', { ns: 'app' })}
          </button>
        </div>
      </div>

      {isCreateDialogOpen && (
        <CreateSnippetDialog
          isOpen={isCreateDialogOpen}
          isSubmitting={createSnippetMutation.isPending}
          onClose={() => setIsCreateDialogOpen(false)}
          onConfirm={handleCreateSnippet}
        />
      )}

      {isImportDSLDialogOpen && (
        <SnippetImportDSLDialog
          show={isImportDSLDialogOpen}
          onClose={() => setIsImportDSLDialogOpen(false)}
          onSuccess={(snippetId) => {
            setIsImportDSLDialogOpen(false)
            push(`/snippets/${snippetId}/orchestrate`)
          }}
        />
      )}
    </>
  )
}

export default SnippetCreateCard
