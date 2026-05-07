'use client'
import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useDebounceFn, useKeyPress } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { useProviderContext } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import AppIconPicker from '../../base/app-icon-picker'
import ShortcutsName from '../../workflow/shortcuts-name'

export type CreateAppModalProps = {
  show: boolean
  isEditModal?: boolean
  appName: string
  appDescription: string
  appIconType: AppIconType | null
  appIcon: string
  appIconBackground?: string | null
  appIconUrl?: string | null
  appMode?: string
  appUseIconAsAnswerIcon?: boolean
  max_active_requests?: number | null
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string
    description: string
    use_icon_as_answer_icon?: boolean
    max_active_requests?: number | null
  }) => Promise<void>
  confirmDisabled?: boolean
  onHide: () => void
}

type CreateAppPayload = Parameters<CreateAppModalProps['onConfirm']>[0]

const CreateAppModal = ({
  show = false,
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
  onHide,
}: CreateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)
  const [appIcon, setAppIcon] = useState(
    () => appIconType === 'image'
      ? { type: 'image' as const, fileId: _appIcon, url: appIconUrl }
      : { type: 'emoji' as const, icon: _appIcon, background: appIconBackground },
  )
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [description, setDescription] = useState(appDescription || '')
  const [useIconAsAnswerIcon, setUseIconAsAnswerIcon] = useState(appUseIconAsAnswerIcon || false)

  const [maxActiveRequestsInput, setMaxActiveRequestsInput] = useState(
    max_active_requests !== null && max_active_requests !== undefined ? String(max_active_requests) : '',
  )

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = useCallback(() => {
    if (!name.trim()) {
      toast(t('appCustomize.nameRequired', { ns: 'explore' }), { type: 'error' })
      return
    }
    const parsedMaxActiveRequests = Number(maxActiveRequestsInput)
    const isValid = maxActiveRequestsInput.trim() !== '' && !Number.isNaN(parsedMaxActiveRequests)
    const payload: CreateAppPayload = {
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background! : undefined,
      description,
      use_icon_as_answer_icon: useIconAsAnswerIcon,
    }
    if (isValid)
      payload.max_active_requests = parsedMaxActiveRequests

    onConfirm(payload)
    onHide()
  }, [name, appIcon, description, useIconAsAnswerIcon, onConfirm, onHide, t, maxActiveRequestsInput])

  const { run: handleSubmit } = useDebounceFn(submit, { wait: 300 })

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !(!isEditModal && isAppsFull) && name.trim())
      handleSubmit()
  })

  return (
    <>
      <Dialog open={show} onOpenChange={open => !open && onHide()} disablePointerDismissal>
        <DialogContent className="px-8">
          <DialogCloseButton />
          {isEditModal && (
            <DialogTitle className="mb-9 text-xl leading-[30px] font-semibold text-text-primary">{t('editAppTitle', { ns: 'app' })}</DialogTitle>
          )}
          {!isEditModal && (
            <DialogTitle className="mb-9 text-xl leading-[30px] font-semibold text-text-primary">{t('appCustomize.title', { ns: 'explore', name: appName })}</DialogTitle>
          )}
          <div className="mb-9">
            {/* icon & name */}
            <div className="pt-2">
              <div className="py-2 text-sm leading-[20px] font-medium text-text-primary">{t('newApp.captionName', { ns: 'app' })}</div>
              <div className="flex items-center justify-between space-x-2">
                <AppIcon
                  size="large"
                  onClick={() => { setShowAppIconPicker(true) }}
                  className="cursor-pointer"
                  iconType={appIcon.type}
                  icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                  background={appIcon.type === 'image' ? undefined : appIcon.background}
                  imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                />
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('newApp.appNamePlaceholder', { ns: 'app' }) || ''}
                  className="h-10 grow"
                />
              </div>
            </div>
            {/* description */}
            <div className="pt-2">
              <div className="py-2 text-sm leading-[20px] font-medium text-text-primary">{t('newApp.captionDescription', { ns: 'app' })}</div>
              <Textarea
                className="resize-none"
                placeholder={t('newApp.appDescriptionPlaceholder', { ns: 'app' }) || ''}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            {/* answer icon */}
            {isEditModal && (appMode === AppModeEnum.CHAT || appMode === AppModeEnum.ADVANCED_CHAT || appMode === AppModeEnum.AGENT_CHAT) && (
              <div className="pt-2">
                <div className="flex items-center justify-between">
                  <div className="py-2 text-sm leading-[20px] font-medium text-text-primary">{t('answerIcon.title', { ns: 'app' })}</div>
                  <Switch
                    checked={useIconAsAnswerIcon}
                    onCheckedChange={v => setUseIconAsAnswerIcon(v)}
                  />
                </div>
                <p className="body-xs-regular text-text-tertiary">{t('answerIcon.descriptionInExplore', { ns: 'app' })}</p>
              </div>
            )}
            {isEditModal && (
              <div className="pt-2">
                <div className="mt-2 mb-2 text-sm leading-[20px] font-medium text-text-primary">{t('maxActiveRequests', { ns: 'app' })}</div>
                <Input
                  type="number"
                  min={1}
                  placeholder={t('maxActiveRequestsPlaceholder', { ns: 'app' })}
                  value={maxActiveRequestsInput}
                  onChange={(e) => {
                    setMaxActiveRequestsInput(e.target.value)
                  }}
                  className="h-10 w-full"
                />
                <p className="mt-2 mb-0 body-xs-regular text-text-tertiary">{t('maxActiveRequestsTip', { ns: 'app' })}</p>
              </div>
            )}
            {!isEditModal && isAppsFull && <AppsFull className="mt-4" loc="app-explore-create" />}
          </div>
          <div className="flex flex-row-reverse">
            <Button
              disabled={(!isEditModal && isAppsFull) || !name.trim() || confirmDisabled}
              className="ml-2 w-24 gap-1"
              variant="primary"
              onClick={handleSubmit}
            >
              <span>{!isEditModal ? t('operation.create', { ns: 'common' }) : t('operation.save', { ns: 'common' })}</span>
              <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />
            </Button>
            <Button className="w-24" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {showAppIconPicker && (
        <AppIconPicker
          initialEmoji={appIcon.type === 'emoji'
            ? { icon: appIcon.icon, background: appIcon.background }
            : undefined}
          onSelect={(payload) => {
            setAppIcon(payload)
            setShowAppIconPicker(false)
          }}
          onClose={() => {
            setShowAppIconPicker(false)
          }}
        />
      )}
    </>
  )
}

export default CreateAppModal
