'use client'
import type { FC } from 'react'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { AppDetailResponse } from '@/models/app'
import type { AppIconType, AppSSO, Language } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import PremiumBadge from '@/app/components/base/premium-badge'
import Textarea from '@/app/components/base/textarea'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { AppModeEnum } from '@/types/app'

type ISettingsModalProps = {
  isChat: boolean
  appInfo: AppDetailResponse & Partial<AppSSO>
  isShow: boolean
  defaultValue?: string
  onClose: () => void
  onSave?: (params: ConfigParams) => Promise<void>
}

export type ConfigParams = {
  title: string
  description: string
  default_language: string
  chat_color_theme: string
  chat_color_theme_inverted: boolean
  prompt_public: boolean
  copyright: string
  privacy_policy: string
  custom_disclaimer: string
  icon_type: AppIconType
  icon: string
  icon_background?: string
  show_workflow_steps: boolean
  use_icon_as_answer_icon: boolean
  enable_sso?: boolean
}

const prefixSettings = 'overview.appInfo.settings'
type SelectOption = {
  value: Language
  name: string
}

const LANGUAGE_OPTIONS: SelectOption[] = languages.filter(item => item.supported)

const createInputInfo = (appInfo: ISettingsModalProps['appInfo']) => {
  const {
    title,
    description,
    chat_color_theme,
    chat_color_theme_inverted,
    copyright,
    privacy_policy,
    custom_disclaimer,
    show_workflow_steps,
    use_icon_as_answer_icon,
  } = appInfo.site

  return {
    title,
    desc: description,
    chatColorTheme: chat_color_theme,
    chatColorThemeInverted: chat_color_theme_inverted,
    copyright,
    copyrightSwitchValue: !!copyright,
    privacyPolicy: privacy_policy,
    customDisclaimer: custom_disclaimer,
    show_workflow_steps,
    use_icon_as_answer_icon,
    enable_sso: appInfo.enable_sso,
  }
}

const createAppIcon = (appInfo: ISettingsModalProps['appInfo']): AppIconSelection => {
  const { icon_type, icon, icon_background, icon_url } = appInfo.site

  return icon_type === 'image'
    ? { type: 'image', url: icon_url!, fileId: icon }
    : { type: 'emoji', icon, background: icon_background! }
}

const getSettingsResetKey = (appInfo: ISettingsModalProps['appInfo']) => JSON.stringify([
  appInfo.id,
  appInfo.enable_sso,
  appInfo.site.title,
  appInfo.site.description,
  appInfo.site.chat_color_theme,
  appInfo.site.chat_color_theme_inverted,
  appInfo.site.copyright,
  appInfo.site.privacy_policy,
  appInfo.site.custom_disclaimer,
  appInfo.site.default_language,
  appInfo.site.icon_type,
  appInfo.site.icon,
  appInfo.site.icon_background,
  appInfo.site.icon_url,
  appInfo.site.show_workflow_steps,
  appInfo.site.use_icon_as_answer_icon,
])

const SettingsModal: FC<ISettingsModalProps> = ({
  isChat,
  appInfo,
  isShow = false,
  onClose,
  onSave,
}) => {
  const [isShowMore, setIsShowMore] = useState(false)
  const { default_language } = appInfo.site
  const nextInputInfo = createInputInfo(appInfo)
  const nextAppIcon = createAppIcon(appInfo)
  const settingsResetKey = getSettingsResetKey(appInfo)
  const [inputInfo, setInputInfo] = useState(nextInputInfo)
  const [language, setLanguage] = useState(default_language)
  const [saveLoading, setSaveLoading] = useState(false)
  const { t } = useTranslation()

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState<AppIconSelection>(nextAppIcon)
  const [previousIsShow, setPreviousIsShow] = useState(isShow)
  const [previousSettingsResetKey, setPreviousSettingsResetKey] = useState(settingsResetKey)

  const { enableBilling, plan, webappCopyrightEnabled } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === 'sandbox'
  const selectedLanguage = LANGUAGE_OPTIONS.find(item => item.value === language)

  const handleLanguageChange = (nextValue: string | null) => {
    const nextLanguage = LANGUAGE_OPTIONS.find(item => item.value === nextValue)
    if (nextLanguage)
      setLanguage(nextLanguage.value)
  }
  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  const shouldResetForm = isShow && (!previousIsShow || settingsResetKey !== previousSettingsResetKey)
  if (isShow !== previousIsShow || shouldResetForm) {
    setPreviousIsShow(isShow)
    if (shouldResetForm) {
      setInputInfo(nextInputInfo)
      setLanguage(default_language)
      setAppIcon(nextAppIcon)
      setIsShowMore(false)
      setPreviousSettingsResetKey(settingsResetKey)
    }
  }

  const onHide = () => {
    onClose()
    setIsShowMore(false)
  }

  const onClickSave = async () => {
    if (!inputInfo.title) {
      toast.error(t('newApp.nameNotEmpty', { ns: 'app' }))
      return
    }

    const validateColorHex = (hex: string | null) => {
      if (hex === null || hex?.length === 0)
        return true

      const regex = /#[A-F0-9]{6}/i
      const check = regex.test(hex)
      return check
    }

    const validatePrivacyPolicy = (privacyPolicy: string | null) => {
      if (privacyPolicy === null || privacyPolicy?.length === 0)
        return true

      return privacyPolicy.startsWith('http://') || privacyPolicy.startsWith('https://')
    }

    if (inputInfo !== null) {
      if (!validateColorHex(inputInfo.chatColorTheme)) {
        toast.error(t(`${prefixSettings}.invalidHexMessage`, { ns: 'appOverview' }))
        return
      }
      if (!validatePrivacyPolicy(inputInfo.privacyPolicy)) {
        toast.error(t(`${prefixSettings}.invalidPrivacyPolicy`, { ns: 'appOverview' }))
        return
      }
    }

    setSaveLoading(true)
    const params = {
      title: inputInfo.title,
      description: inputInfo.desc,
      default_language: language,
      chat_color_theme: inputInfo.chatColorTheme,
      chat_color_theme_inverted: inputInfo.chatColorThemeInverted,
      prompt_public: false,
      copyright: !webappCopyrightEnabled
        ? ''
        : inputInfo.copyrightSwitchValue
          ? inputInfo.copyright
          : '',
      privacy_policy: inputInfo.privacyPolicy,
      custom_disclaimer: inputInfo.customDisclaimer,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
      show_workflow_steps: inputInfo.show_workflow_steps,
      use_icon_as_answer_icon: inputInfo.use_icon_as_answer_icon,
      enable_sso: inputInfo.enable_sso,
    }
    await onSave?.(params)
    setSaveLoading(false)
    onHide()
  }

  const onChange = (field: string) => {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      let value: string | boolean
      if (e.target.type === 'checkbox')
        value = (e.target as HTMLInputElement).checked
      else
        value = e.target.value

      setInputInfo(item => ({ ...item, [field]: value }))
    }
  }

  const onDesChange = (value: string) => {
    setInputInfo(item => ({ ...item, desc: value }))
  }

  return (
    <>
      <Dialog open={isShow} onOpenChange={open => !open && onHide()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[520px] overflow-visible p-0">
          {/* header */}
          <div className="pt-5 pr-5 pb-3 pl-6">
            <div className="flex items-center gap-1">
              <DialogTitle className="grow title-2xl-semi-bold text-text-primary">{t(`${prefixSettings}.title`, { ns: 'appOverview' })}</DialogTitle>
              <DialogCloseButton className="relative top-auto right-auto shrink-0" />
            </div>
            <div className="mt-0.5 system-xs-regular text-text-tertiary">
              <span>{t(`${prefixSettings}.modalTip`, { ns: 'appOverview' })}</span>
            </div>
          </div>
          {/* form body */}
          <div className="space-y-5 px-6 py-3">
            {/* name & icon */}
            <div className="flex gap-4">
              <div className="grow">
                <div className={cn('mb-1 py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.webName`, { ns: 'appOverview' })}</div>
                <Input
                  className="w-full"
                  value={inputInfo.title}
                  onChange={onChange('title')}
                  placeholder={t('appNamePlaceholder', { ns: 'app' }) || ''}
                />
              </div>
              <AppIcon
                size="xxl"
                onClick={() => { setShowAppIconPicker(true) }}
                className="mt-2 cursor-pointer"
                iconType={appIcon.type}
                icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                background={appIcon.type === 'image' ? undefined : appIcon.background}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              />
            </div>
            {/* description */}
            <div className="relative">
              <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.webDesc`, { ns: 'appOverview' })}</div>
              <Textarea
                className="mt-1"
                value={inputInfo.desc}
                onChange={e => onDesChange(e.target.value)}
                placeholder={t(`${prefixSettings}.webDescPlaceholder`, { ns: 'appOverview' }) as string}
              />
              <p className={cn('pb-0.5 body-xs-regular text-text-tertiary')}>{t(`${prefixSettings}.webDescTip`, { ns: 'appOverview' })}</p>
            </div>
            <Divider className="my-0 h-px" />
            {/* answer icon */}
            {isChat && (
              <div className="w-full">
                <div className="flex items-center justify-between">
                  <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t('answerIcon.title', { ns: 'app' })}</div>
                  <Switch
                    checked={inputInfo.use_icon_as_answer_icon}
                    onCheckedChange={v => setInputInfo({ ...inputInfo, use_icon_as_answer_icon: v })}
                  />
                </div>
                <p className="pb-0.5 body-xs-regular text-text-tertiary">{t('answerIcon.description', { ns: 'app' })}</p>
              </div>
            )}
            {/* language */}
            <div className="flex items-center">
              <div className={cn('grow py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.language`, { ns: 'appOverview' })}</div>
              <Select
                value={selectedLanguage?.value ?? null}
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger
                  aria-label={t(`${prefixSettings}.language`, { ns: 'appOverview' })}
                  size="large"
                  className="w-[200px]"
                >
                  {selectedLanguage?.name ?? t('placeholder.select', { ns: 'common' })}
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      <SelectItemText>{item.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* theme color */}
            {isChat && (
              <div className="flex items-center">
                <div className="grow">
                  <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.chatColorTheme`, { ns: 'appOverview' })}</div>
                  <div className="pb-0.5 body-xs-regular text-text-tertiary">{t(`${prefixSettings}.chatColorThemeDesc`, { ns: 'appOverview' })}</div>
                </div>
                <div className="shrink-0">
                  <Input
                    className="mb-1 w-[200px]"
                    value={inputInfo.chatColorTheme ?? ''}
                    onChange={onChange('chatColorTheme')}
                    placeholder="E.g #A020F0"
                  />
                  <div className="flex items-center justify-between">
                    <p className={cn('body-xs-regular text-text-tertiary')}>{t(`${prefixSettings}.chatColorThemeInverted`, { ns: 'appOverview' })}</p>
                    <Switch checked={inputInfo.chatColorThemeInverted} onCheckedChange={v => setInputInfo({ ...inputInfo, chatColorThemeInverted: v })}></Switch>
                  </div>
                </div>
              </div>
            )}
            {/* workflow detail */}
            <div className="w-full">
              <div className="flex items-center justify-between">
                <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.workflow.subTitle`, { ns: 'appOverview' })}</div>
                <Switch
                  disabled={!(appInfo.mode === AppModeEnum.WORKFLOW || appInfo.mode === AppModeEnum.ADVANCED_CHAT)}
                  checked={inputInfo.show_workflow_steps}
                  onCheckedChange={v => setInputInfo({ ...inputInfo, show_workflow_steps: v })}
                />
              </div>
              <p className="pb-0.5 body-xs-regular text-text-tertiary">{t(`${prefixSettings}.workflow.showDesc`, { ns: 'appOverview' })}</p>
            </div>
            {/* more settings switch */}
            <Divider className="my-0 h-px" />
            {!isShowMore && (
              <div className="flex cursor-pointer items-center" onClick={() => setIsShowMore(true)}>
                <div className="grow">
                  <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.more.entry`, { ns: 'appOverview' })}</div>
                  <p className={cn('pb-0.5 body-xs-regular text-text-tertiary')}>
                    {t(`${prefixSettings}.more.copyRightPlaceholder`, { ns: 'appOverview' })}
                    {' '}
                    &
                    {' '}
                    {t(`${prefixSettings}.more.privacyPolicyPlaceholder`, { ns: 'appOverview' })}
                  </p>
                </div>
                <span aria-hidden="true" className="ml-1 i-ri-arrow-right-s-line h-4 w-4 shrink-0 text-text-secondary" />
              </div>
            )}
            {/* more settings */}
            {isShowMore && (
              <>
                {/* copyright */}
                <div className="w-full">
                  <div className="flex items-center">
                    <div className="flex grow items-center">
                      <div className={cn('mr-1 py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.more.copyright`, { ns: 'appOverview' })}</div>
                      {/* upgrade button */}
                      {enableBilling && isFreePlan && (
                        <div className="h-[18px] select-none">
                          <PremiumBadge size="s" color="blue" allowHover={true} onClick={handlePlanClick}>
                            <span aria-hidden="true" className="i-custom-public-common-sparkles-soft flex h-3.5 w-3.5 items-center py-px pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
                            <div className="system-xs-medium">
                              <span className="p-1">
                                {t('upgradeBtn.encourageShort', { ns: 'billing' })}
                              </span>
                            </div>
                          </PremiumBadge>
                        </div>
                      )}
                    </div>
                    {webappCopyrightEnabled
                      ? (
                          <Switch
                            checked={inputInfo.copyrightSwitchValue}
                            onCheckedChange={v => setInputInfo({ ...inputInfo, copyrightSwitchValue: v })}
                          />
                        )
                      : (
                          <Tooltip>
                            <TooltipTrigger
                              render={(
                                <div>
                                  <Switch
                                    disabled
                                    checked={inputInfo.copyrightSwitchValue}
                                    onCheckedChange={v => setInputInfo({ ...inputInfo, copyrightSwitchValue: v })}
                                  />
                                </div>
                              )}
                            />
                            <TooltipContent className="w-[180px]">
                              {t(`${prefixSettings}.more.copyrightTooltip`, { ns: 'appOverview' })}
                            </TooltipContent>
                          </Tooltip>
                        )}
                  </div>
                  <p className="pb-0.5 body-xs-regular text-text-tertiary">{t(`${prefixSettings}.more.copyrightTip`, { ns: 'appOverview' })}</p>
                  {inputInfo.copyrightSwitchValue && (
                    <Input
                      className="mt-2 h-10"
                      value={inputInfo.copyright}
                      onChange={onChange('copyright')}
                      placeholder={t(`${prefixSettings}.more.copyRightPlaceholder`, { ns: 'appOverview' }) as string}
                    />
                  )}
                </div>
                {/* privacy policy */}
                <div className="w-full">
                  <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.more.privacyPolicy`, { ns: 'appOverview' })}</div>
                  <p className={cn('pb-0.5 body-xs-regular text-text-tertiary')}>
                    <Trans
                      i18nKey={`${prefixSettings}.more.privacyPolicyTip`}
                      ns="appOverview"
                      components={{ privacyPolicyLink: <Link href="https://dify.ai/privacy" target="_blank" rel="noopener noreferrer" className="text-text-accent" /> }}
                    />
                  </p>
                  <Input
                    className="mt-1"
                    value={inputInfo.privacyPolicy}
                    onChange={onChange('privacyPolicy')}
                    placeholder={t(`${prefixSettings}.more.privacyPolicyPlaceholder`, { ns: 'appOverview' }) as string}
                  />
                </div>
                {/* custom disclaimer */}
                <div className="w-full">
                  <div className={cn('py-1 system-sm-semibold text-text-secondary')}>{t(`${prefixSettings}.more.customDisclaimer`, { ns: 'appOverview' })}</div>
                  <p className={cn('pb-0.5 body-xs-regular text-text-tertiary')}>{t(`${prefixSettings}.more.customDisclaimerTip`, { ns: 'appOverview' })}</p>
                  <Textarea
                    className="mt-1"
                    value={inputInfo.customDisclaimer}
                    onChange={onChange('customDisclaimer')}
                    placeholder={t(`${prefixSettings}.more.customDisclaimerPlaceholder`, { ns: 'appOverview' }) as string}
                  />
                </div>
              </>
            )}
          </div>
          {/* footer */}
          <div className="flex justify-end p-6 pt-5">
            <Button className="mr-2" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
            <Button variant="primary" onClick={onClickSave} loading={saveLoading}>{t('operation.save', { ns: 'common' })}</Button>
          </div>
          {showAppIconPicker && (
            <div onClick={e => e.stopPropagation()}>
              <AppIconPicker
                onSelect={(payload) => {
                  setAppIcon(payload)
                  setShowAppIconPicker(false)
                }}
                onClose={() => {
                  setAppIcon(createAppIcon(appInfo))
                  setShowAppIconPicker(false)
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
export default React.memo(SettingsModal)
