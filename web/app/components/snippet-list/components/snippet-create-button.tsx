'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSnippetDialog from '@/app/components/snippets/create-snippet-dialog'
import { useCreateSnippet } from '@/app/components/snippets/hooks/use-create-snippet'
import ImportSnippetDSLDialog from '@/app/components/snippets/import-snippet-dsl-dialog'

const SnippetCreateButton = () => {
  const { t } = useTranslation('snippet')
  const {
    canCreateAndModifySnippet,
    createSnippetMutation,
    handleCreateSnippet,
    isCreatingSnippet,
  } = useCreateSnippet()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const isSubmitting = isCreatingSnippet || createSnippetMutation.isPending

  if (!canCreateAndModifySnippet) return null

  return (
    <>
      <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <PopoverTrigger
          render={
            <Button disabled={isSubmitting}>
              <span aria-hidden className="mr-0.5 i-ri-add-line size-4" />
              <span>{t(($) => $.create)}</span>
              <span aria-hidden className="ml-0.5 i-ri-arrow-down-s-line size-4" />
            </Button>
          }
        />
        <PopoverContent
          placement="bottom-end"
          sideOffset={6}
          popupClassName="w-[228px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-xs"
        >
          <div className="px-2 pt-2 pb-1 text-xs leading-4.5 font-medium text-text-tertiary">
            {t(($) => $.createFrom)}
          </div>
          <button
            type="button"
            className="mb-1 flex w-full cursor-pointer items-center rounded-lg px-2 py-1.75 text-[13px] leading-4.5 font-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            onClick={() => {
              setIsMenuOpen(false)
              setIsCreateDialogOpen(true)
            }}
          >
            <span
              aria-hidden
              className="mr-2 i-custom-vender-line-files-file-plus-01 size-4 shrink-0"
            />
            <span>{t(($) => $.createFromBlank)}</span>
          </button>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center rounded-lg px-2 py-1.75 text-[13px] leading-4.5 font-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            onClick={() => {
              setIsMenuOpen(false)
              setIsImportDialogOpen(true)
            }}
          >
            <span
              aria-hidden
              className="mr-2 i-custom-vender-line-files-file-arrow-01 size-4 shrink-0"
            />
            <span>{t(($) => $.importDSLFile)}</span>
          </button>
        </PopoverContent>
      </Popover>

      {isCreateDialogOpen && (
        <CreateSnippetDialog
          isOpen={isCreateDialogOpen}
          isSubmitting={isSubmitting}
          onClose={() => setIsCreateDialogOpen(false)}
          onConfirm={async (payload) => {
            await handleCreateSnippet(payload)
            setIsCreateDialogOpen(false)
          }}
        />
      )}
      {isImportDialogOpen && (
        <ImportSnippetDSLDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
        />
      )}
    </>
  )
}

export default SnippetCreateButton
