'use client'
import type {
  AppDetailWithSite,
  UpdateAppPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { formatForDisplay, matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { toast } from '@/app/notifications'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

export type CreateAppModalProps = {
  open: boolean
  isEditModal?: boolean
  appName: string
  appDescription: string
  appIconType: AppDetailWithSite['icon_type']
  appIcon: AppDetailWithSite['icon']
  appIconBackground?: string | null
  appIconUrl?: string | null
  appMode?: string
  appUseIconAsAnswerIcon?: boolean
  max_active_requests?: number | null
  onConfirm: (info: UpdateAppPayload) => Promise<void>
  confirmDisabled?: boolean
  onOpenChange: (open: boolean) => void
}

const SUBMIT_APP_HOTKEY = 'Mod+Enter' satisfies Hotkey

function CreateAppForm({
  open,
  isEditModal = false,
  appIconType,
  appIcon: _appIcon,
  appIconBackground,
  appIconUrl,
  appName,
  appDescription,
  appMode,
  appUseIconAsAnswerIcon,
  max_active_requests,
  onConfirm,
  confirmDisabled,
  isPending,
}: Omit<CreateAppModalProps, 'onOpenChange'> & { isPending: boolean }) {
  const nameInputId = React.useId()
  const descriptionInputId = React.useId()
  const maxActiveRequestsInputId = React.useId()
  const { t } = useTranslation(['app', 'common', 'explore'])

  const [name, setName] = React.useState(appName)
  const [initialIcon] = useState(() => ({
    icon_type: appIconType,
    icon: _appIcon,
    icon_background: appIconBackground,
    icon_url: appIconUrl,
  }))
  const [selectedIcon, setSelectedIcon] = useState<IconPickerValue | null>(null)
  const pickerValue: IconPickerInputValue | undefined =
    selectedIcon ??
    (initialIcon.icon_type === 'image' && initialIcon.icon
      ? { type: 'image', fileId: initialIcon.icon, url: initialIcon.icon_url ?? '' }
      : initialIcon.icon_type === 'emoji' && initialIcon.icon
        ? { type: 'emoji', icon: initialIcon.icon, background: initialIcon.icon_background }
        : initialIcon.icon_type === 'link' && initialIcon.icon
          ? { type: 'link', url: initialIcon.icon }
          : undefined)
  const currentIcon = selectedIcon
    ? {
        icon_type: selectedIcon.type,
        icon: selectedIcon.type === 'emoji' ? selectedIcon.icon : selectedIcon.fileId,
        icon_background: selectedIcon.type === 'emoji' ? selectedIcon.background : undefined,
        icon_url: selectedIcon.type === 'image' ? selectedIcon.url : undefined,
      }
    : initialIcon
  const {
    icon_type: currentIconType,
    icon: currentIconValue,
    icon_background: currentIconBackground,
  } = currentIcon
  const [description, setDescription] = useState(appDescription || '')
  const [useIconAsAnswerIcon, setUseIconAsAnswerIcon] = useState(appUseIconAsAnswerIcon || false)

  const [maxActiveRequestsInput, setMaxActiveRequestsInput] = useState(
    max_active_requests !== null && max_active_requests !== undefined
      ? String(max_active_requests)
      : '',
  )

  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: appQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD' && !isEditModal,
      select: (data) => data.apps,
    }),
  )
  const isAppQuotaUnavailable =
    deploymentEdition === 'CLOUD' && !isEditModal && appQuota === undefined
  // A limit of 0 means unlimited.
  const isAppsFull =
    deploymentEdition === 'CLOUD' &&
    appQuota !== undefined &&
    appQuota.limit > 0 &&
    appQuota.size >= appQuota.limit

  const submit = () => {
    if (isPending || confirmDisabled || (!isEditModal && (isAppQuotaUnavailable || isAppsFull)))
      return
    if (!name.trim()) {
      toast(
        t(($) => $['appCustomize.nameRequired'], { ns: 'explore' }),
        { type: 'error' },
      )
      return
    }
    const parsedMaxActiveRequests = Number(maxActiveRequestsInput)
    const isValid = maxActiveRequestsInput.trim() !== '' && !Number.isNaN(parsedMaxActiveRequests)
    const payload: UpdateAppPayload = {
      name,
      icon_type: currentIconType,
      icon: currentIconValue,
      icon_background: currentIconBackground,
      description,
      use_icon_as_answer_icon: useIconAsAnswerIcon,
    }
    if (isValid) payload.max_active_requests = parsedMaxActiveRequests

    void onConfirm(payload)
  }

  const submitDisabled =
    isAppQuotaUnavailable || (!isEditModal && isAppsFull) || !name.trim() || !!confirmDisabled

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The form handles its submit shortcut after child controls, excluding nested portals.
    <form
      noValidate
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (
          !open ||
          submitDisabled ||
          isPending ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target) ||
          !matchesKeyboardEvent(event.nativeEvent, SUBMIT_APP_HOTKEY)
        )
          return
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        submit()
      }}
    >
      <DialogClose
        disabled={isPending}
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute inset-e-6 top-6"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />
      {isEditModal && (
        <DialogTitle className="text-xl leading-7.5 font-semibold text-text-primary">
          {t(($) => $.editAppTitle, { ns: 'app' })}
        </DialogTitle>
      )}
      {!isEditModal && (
        <DialogTitle className="text-xl leading-7.5 font-semibold text-text-primary">
          {t(($) => $['appCustomize.title'], { ns: 'explore', name: appName })}
        </DialogTitle>
      )}
      <div className="mb-9">
        {/* icon & name */}
        <div className="pt-2">
          <label
            htmlFor={nameInputId}
            className="block py-2 text-sm leading-5 font-medium text-text-primary"
          >
            {t(($) => $['newApp.captionName'], { ns: 'app' })}
          </label>
          <div className="flex items-center justify-between space-x-2">
            <IconPicker value={pickerValue} onValueChange={setSelectedIcon}>
              <IconPickerTrigger
                disabled={isPending}
                aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                className="shrink-0 cursor-pointer rounded-[10px]"
              >
                <IconPickerIcon size="large" />
              </IconPickerTrigger>
              <IconPickerContent />
            </IconPicker>
            <Input
              id={nameInputId}
              value={name}
              readOnly={isPending}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
              className="h-10 grow"
            />
          </div>
        </div>
        {/* description */}
        <div className="pt-2">
          <label
            htmlFor={descriptionInputId}
            className="block py-2 text-sm leading-5 font-medium text-text-primary"
          >
            {t(($) => $['newApp.captionDescription'], { ns: 'app' })}
          </label>
          <Textarea
            id={descriptionInputId}
            className="resize-none"
            placeholder={t(($) => $['newApp.appDescriptionPlaceholder'], { ns: 'app' }) || ''}
            value={description}
            readOnly={isPending}
            onValueChange={(value) => setDescription(value)}
          />
        </div>
        {/* answer icon */}
        {isEditModal &&
          (appMode === AppModeEnum.CHAT ||
            appMode === AppModeEnum.ADVANCED_CHAT ||
            appMode === AppModeEnum.AGENT_CHAT) && (
            <div className="pt-2">
              <div className="flex items-center justify-between">
                <div className="py-2 text-sm leading-5 font-medium text-text-primary">
                  {t(($) => $['answerIcon.title'], { ns: 'app' })}
                </div>
                <Switch
                  checked={useIconAsAnswerIcon}
                  readOnly={isPending}
                  aria-label={t(($) => $['answerIcon.title'], { ns: 'app' })}
                  onCheckedChange={(v) => setUseIconAsAnswerIcon(v)}
                />
              </div>
              <p className="body-xs-regular text-text-tertiary">
                {t(($) => $['answerIcon.descriptionInExplore'], { ns: 'app' })}
              </p>
            </div>
          )}
        {isEditModal && (
          <div className="pt-2">
            <label
              htmlFor={maxActiveRequestsInputId}
              className="mt-2 mb-2 block text-sm leading-5 font-medium text-text-primary"
            >
              {t(($) => $.maxActiveRequests, { ns: 'app' })}
            </label>
            <Input
              id={maxActiveRequestsInputId}
              type="number"
              min={1}
              placeholder={t(($) => $.maxActiveRequestsPlaceholder, { ns: 'app' })}
              value={maxActiveRequestsInput}
              readOnly={isPending}
              onChange={(e) => {
                setMaxActiveRequestsInput(e.target.value)
              }}
              className="h-10 w-full"
            />
            <p className="mt-2 mb-0 body-xs-regular text-text-tertiary">
              {t(($) => $.maxActiveRequestsTip, { ns: 'app' })}
            </p>
          </div>
        )}
        {!isEditModal && isAppsFull && <AppsFull className="mt-4" loc="app-explore-create" />}
      </div>
      <div className="flex flex-row-reverse">
        <Button
          loading={isPending}
          disabled={submitDisabled}
          className="ml-2 w-24"
          variant="primary"
          type="submit"
        >
          <span>
            {!isEditModal
              ? t(($) => $['operation.create'], { ns: 'common' })
              : t(($) => $['operation.save'], { ns: 'common' })}
          </span>
          <KbdGroup>
            {formatForDisplay(SUBMIT_APP_HOTKEY, { parts: true }).map((key) => (
              <Kbd key={key} color="white">
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        </Button>
        <DialogClose disabled={isPending} render={<Button className="w-24" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
      </div>
    </form>
  )
}

export default function CreateAppModal({
  open,
  onOpenChange,
  onConfirm,
  ...props
}: CreateAppModalProps) {
  const [isPending, setIsPending] = useState(false)
  const handleConfirm = async (info: UpdateAppPayload) => {
    if (isPending) return
    setIsPending(true)
    try {
      await onConfirm(info)
    } catch {
      // The caller owns request feedback and closes after its successful operation.
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) details.cancel()
        else onOpenChange(nextOpen)
      }}
      disablePointerDismissal
    >
      <DialogContent backdropProps={{ forceRender: true }} className="px-8">
        <CreateAppForm {...props} open={open} onConfirm={handleConfirm} isPending={isPending} />
      </DialogContent>
    </Dialog>
  )
}
