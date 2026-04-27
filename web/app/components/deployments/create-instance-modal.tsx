'use client'
import type { FC } from 'react'
import type { AppInfo } from './types'
import type { AppModeEnum } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import { useRouter } from '@/next/navigation'
import { useDeploymentsStore } from './store'
import { useSourceApps } from './use-source-apps'

type AppPickerProps = {
  apps: AppInfo[]
  isLoading: boolean
  value: string
  onChange: (appId: string) => void
}

export const AppPicker: FC<AppPickerProps> = ({ apps, isLoading, value, onChange }) => {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>(undefined)

  const selected = useMemo(() => apps.find(a => a.id === value), [apps, value])

  const filtered = useMemo(() => {
    const q = keywords.trim().toLowerCase()
    if (!q)
      return apps
    return apps.filter(a => a.name.toLowerCase().includes(q) || a.mode.toLowerCase().includes(q))
  }, [apps, keywords])

  const handleOpenChange = (next: boolean) => {
    if (next && triggerRef.current)
      setTriggerWidth(triggerRef.current.offsetWidth)
    if (!next)
      setKeywords('')
    setOpen(next)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-6 text-center system-sm-regular text-text-tertiary">
        {t('createModal.loadingApps')}
      </div>
    )
  }

  if (apps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-6 text-center system-sm-regular text-text-tertiary">
        {t('createModal.noApps')}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-lg border-[0.5px] bg-components-input-bg-normal pr-2 pl-2 text-left transition-colors',
              open
                ? 'border-components-input-border-active'
                : 'border-components-input-border-active hover:border-components-input-border-hover',
            )}
          />
        )}
      >
        {selected
          ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative shrink-0">
                  <AppIcon
                    size="tiny"
                    iconType={selected.iconType}
                    icon={selected.icon}
                    background={selected.iconBackground}
                    imageUrl={selected.iconUrl}
                  />
                  <AppTypeIcon
                    type={selected.mode as unknown as AppModeEnum}
                    wrapperClassName="absolute -bottom-0.5 -right-0.5 w-3 h-3 shadow-sm"
                    className="h-2 w-2"
                  />
                </div>
                <span className="truncate system-sm-medium text-text-secondary">{selected.name}</span>
                <span className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">{selected.mode}</span>
              </div>
            )
          : (
              <span className="system-sm-regular text-text-quaternary">
                {t('createModal.appPickerPlaceholder')}
              </span>
            )}
        <span
          aria-hidden
          className={cn('i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary transition-transform', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="p-0 overflow-hidden"
      >
        <div style={triggerWidth ? { width: triggerWidth } : undefined} className="flex flex-col">
          <div className="p-2">
            <Input
              showLeftIcon
              showClearIcon
              placeholder={t('createModal.appSearchPlaceholder')}
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              onClear={() => setKeywords('')}
              autoFocus
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto px-1 pb-1">
            {filtered.length === 0
              ? (
                  <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                    {t('createModal.appSearchEmpty')}
                  </div>
                )
              : filtered.map((app) => {
                  const isSelected = app.id === value
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        onChange(app.id)
                        setOpen(false)
                        setKeywords('')
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        'hover:bg-state-base-hover',
                        isSelected && 'bg-state-base-hover',
                      )}
                    >
                      <div className="relative shrink-0">
                        <AppIcon
                          size="tiny"
                          iconType={app.iconType}
                          icon={app.icon}
                          background={app.iconBackground}
                          imageUrl={app.iconUrl}
                        />
                        <AppTypeIcon
                          type={app.mode as unknown as AppModeEnum}
                          wrapperClassName="absolute -bottom-0.5 -right-0.5 w-3 h-3 shadow-sm"
                          className="h-2 w-2"
                        />
                      </div>
                      <span className="min-w-0 grow truncate system-sm-medium text-text-secondary">
                        {app.name}
                      </span>
                      <span className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">
                        {app.mode}
                      </span>
                      {isSelected && (
                        <span aria-hidden className="i-ri-check-line h-4 w-4 shrink-0 text-text-accent" />
                      )}
                    </button>
                  )
                })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const CreateInstanceForm: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const createInstance = useDeploymentsStore(state => state.createInstance)
  const openDeployDrawer = useDeploymentsStore(state => state.openDeployDrawer)
  const { apps, isLoading } = useSourceApps()

  const [appId, setAppId] = useState<string>('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const selectedApp = apps.find(a => a.id === appId)
  const canCreate = Boolean(appId && name.trim())

  const handleCreate = (thenDeploy: boolean) => {
    if (!canCreate)
      return
    const instanceId = createInstance({
      appId,
      name: name.trim(),
      description: description.trim() || undefined,
    })
    if (thenDeploy) {
      openDeployDrawer({ instanceId })
      return
    }
    router.push(`/deployments/${instanceId}/overview`)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {t('createModal.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('createModal.description')}
        </DialogDescription>
      </div>

      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary">{t('createModal.sourceApp')}</label>
        <AppPicker
          apps={apps}
          isLoading={isLoading}
          value={appId}
          onChange={setAppId}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="instance-name">
          {t('createModal.nameLabel')}
        </label>
        <input
          id="instance-name"
          type="text"
          value={name}
          placeholder={selectedApp?.name ?? t('createModal.namePlaceholder')}
          onChange={e => setName(e.target.value)}
          className="flex h-8 items-center rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 text-[13px] font-medium text-text-secondary outline-hidden placeholder:text-text-quaternary"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="instance-desc">
          {t('createModal.descriptionLabel')}
        </label>
        <textarea
          id="instance-desc"
          value={description}
          placeholder={t('createModal.descriptionPlaceholder')}
          onChange={e => setDescription(e.target.value)}
          className="min-h-[80px] rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 py-2 text-[13px] text-text-secondary outline-hidden placeholder:text-text-quaternary"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('createModal.cancel')}
        </Button>
        <Button variant="secondary" disabled={!canCreate} onClick={() => handleCreate(false)}>
          {t('createModal.create')}
        </Button>
        <Button variant="primary" disabled={!canCreate} onClick={() => handleCreate(true)}>
          {t('createModal.createAndDeploy')}
        </Button>
      </div>
    </div>
  )
}

const CreateInstanceModal: FC = () => {
  const modal = useDeploymentsStore(state => state.createInstanceModal)
  const closeModal = useDeploymentsStore(state => state.closeCreateInstanceModal)

  return (
    <Dialog
      open={modal.open}
      onOpenChange={next => !next && closeModal()}
    >
      <DialogContent className="w-[520px] max-w-[90vw]">
        <DialogCloseButton />
        {modal.open && <CreateInstanceForm onClose={closeModal} />}
      </DialogContent>
    </Dialog>
  )
}

export default CreateInstanceModal
