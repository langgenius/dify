'use client'

import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { consoleQuery } from '@/service/client'
import { SourceAppPicker } from '../../components/create-instance-modal'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460

export function CreateReleaseControl({ appInstanceId, variant = 'primary', size = 'small', label, className }: {
  appInstanceId: string
  variant?: 'primary' | 'secondary'
  size?: 'small' | 'medium'
  label?: string
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const createRelease = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const [isCreating, setIsCreating] = useState(false)
  const [sourceApp, setSourceApp] = useState<App>()
  const [description, setDescription] = useState('')

  function closeDialog() {
    setIsCreating(false)
    setSourceApp(undefined)
    setDescription('')
  }

  function handleCreateRelease(form: HTMLFormElement) {
    if (createRelease.isPending)
      return

    const formData = new FormData(form)
    const releaseName = String(formData.get('name') ?? '').trim()
    const releaseDescription = description.trim()
    if (!releaseName || !sourceApp?.id)
      return

    createRelease.mutate(
      {
        body: {
          appInstanceId,
          sourceAppId: sourceApp.id,
          name: releaseName,
          description: releaseDescription || undefined,
        },
      },
      {
        onSuccess: (response) => {
          if (!response.release?.id) {
            toast.error(t('versions.createFailed'))
            return
          }
          const createdName = response.release.name ?? releaseName
          toast.success(t('versions.createSuccess', { name: createdName }))
          form.reset()
          closeDialog()
        },
        onError: () => {
          toast.error(t('versions.createFailed'))
        },
      },
    )
  }

  const descriptionLength = description.length
  const isNearLimit = descriptionLength >= DESCRIPTION_WARN_THRESHOLD
  const canCreate = Boolean(sourceApp?.id && !createRelease.isPending)

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={createRelease.isPending}
        onClick={() => setIsCreating(true)}
      >
        {label ?? t('versions.createRelease')}
      </Button>

      <Dialog
        open={isCreating}
        onOpenChange={(open) => {
          if (!open)
            closeDialog()
          else
            setIsCreating(true)
        }}
      >
        <DialogContent className="w-140 overflow-hidden p-0">
          <DialogCloseButton />
          {isCreating && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                handleCreateRelease(event.currentTarget)
              }}
            >
              <div className="border-b border-divider-subtle px-6 py-5 pr-14">
                <div className="min-w-0">
                  <DialogTitle className="title-xl-semi-bold text-text-primary">
                    {t('versions.createRelease')}
                  </DialogTitle>
                  <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
                    {t('versions.createReleaseDescription')}
                  </DialogDescription>
                </div>
              </div>

              <div className="flex flex-col gap-5 px-6 py-5">
                <div className="flex flex-col gap-2">
                  <label className="system-xs-medium-uppercase text-text-tertiary">
                    {t('createModal.sourceApp')}
                  </label>
                  <SourceAppPicker
                    value={sourceApp}
                    onChange={setSourceApp}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-name">
                    {t('versions.releaseNameLabel')}
                  </label>
                  <Input
                    id="release-name"
                    name="name"
                    placeholder={t('versions.releaseNamePlaceholder')}
                    maxLength={128}
                    required
                    autoFocus
                    className="h-9"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-description">
                      {t('versions.releaseDescriptionLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="system-xs-regular text-text-quaternary">
                        {t('versions.optional')}
                      </span>
                      <span
                        className={cn(
                          'system-xs-regular tabular-nums',
                          isNearLimit ? 'text-util-colors-warning-warning-700' : 'text-text-quaternary',
                        )}
                      >
                        {descriptionLength}
                        /
                        {DESCRIPTION_MAX_LENGTH}
                      </span>
                    </div>
                  </div>
                  <textarea
                    id="release-description"
                    name="description"
                    placeholder={t('versions.releaseDescriptionPlaceholder')}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="min-h-24 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
                <div className="system-xs-regular text-text-tertiary">
                  {t('versions.createReleaseHint')}
                </div>
                <div className="flex shrink-0 justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={createRelease.isPending}
                    onClick={closeDialog}
                  >
                    {t('versions.cancelCreate')}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="min-w-22"
                    disabled={!canCreate}
                  >
                    {createRelease.isPending ? t('versions.creating') : t('versions.create')}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
