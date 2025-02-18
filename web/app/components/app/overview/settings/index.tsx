'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { RiArrowRightSLine, RiCloseLine } from '@remixicon/react'
import Link from 'next/link'
import { Trans, useTranslation } from 'react-i18next'
import { useContext, useContextSelector } from 'use-context-selector'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import Modal from '@/app/components/base/modal'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppIcon from '@/app/components/base/app-icon'
import Switch from '@/app/components/base/switch'
import PremiumBadge from '@/app/components/base/premium-badge'
import { SimpleSelect } from '@/app/components/base/select'
import type { AppDetailResponse } from '@/models/app'
import type { AppIconType, AppSSO, Language } from '@/types/app'
import { useToastContext } from '@/app/components/base/toast'
import { LanguagesSupported, languages } from '@/i18n/language'
import Tooltip from '@/app/components/base/tooltip'
import AppContext, { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import I18n from '@/context/i18n'
import cn from '@/utils/classnames'

export type ISettingsModalProps = {
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

const prefixSettings = 'appOverview.overview.appInfo.settings'

const SettingsModal: FC<ISettingsModalProps> = ({
  isChat,
  appInfo,
  isShow = false,
  onClose,
  onSave,
}) => {
  const systemFeatures = useContextSelector(AppContext, state => state.systemFeatures)
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { notify } = useToastContext()
  const [isShowMore, setIsShowMore] = useState(false)
  const {
    title,
    icon_type,
    icon,
    icon_background,
    icon_url,
    description,
    chat_color_theme,
    chat_color_theme_inverted,
    copyright,
    privacy_policy,
    custom_disclaimer,
    default_language,
    show_workflow_steps,
    use_icon_as_answer_icon,
  } = appInfo.site
  const [inputInfo, setInputInfo] = useState({
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
  })
  const [language, setLanguage] = useState(default_language)
  const [saveLoading, setSaveLoading] = useState(false)
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
    icon_type === 'image'
      ? { type: 'image', url: icon_url!, fileId: icon }
      : { type: 'emoji', icon, background: icon_background! },
  )

  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === 'sandbox'
  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: 'billing' })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  useEffect(() => {
    setInputInfo({
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
    })
    setLanguage(default_language)
    setAppIcon(icon_type === 'image'
      ? { type: 'image', url: icon_url!, fileId: icon }
      : { type: 'emoji', icon, background: icon_background! })
  }, [appInfo])

  const onHide = () => {
    onClose()
    setTimeout(() => {
      setIsShowMore(false)
    }, 200)
  }

  const onClickSave = async () => {
    if (!inputInfo.title) {
      notify({ type: 'error', message: t('app.newApp.nameNotEmpty') })
      return
    }

    const validateColorHex = (hex: string | null) => {
      if (hex === null || hex?.length === 0)
        return true

      const regex = /#([A-Fa-f0-9]{6})/
      const check = regex.test(hex)
      return check
    }

    if (inputInfo !== null) {
      if (!validateColorHex(inputInfo.chatColorTheme)) {
        notify({ type: 'error', message: t(`${prefixSettings}.invalidHexMessage`) })
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
      copyright: isFreePlan
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
      <Modal
        isShow={isShow}
        closable={false}
        onClose={onHide}
        className='max-w-[520px] p-0'
      >
        {/* header */}
        <div className='pb-3 pl-6 pr-5 pt-5'>
          <div className='flex items-center gap-1'>
            <div className='text-text-primary title-2xl-semi-bold grow'>{t(`${prefixSettings}.title`)}</div>
            <ActionButton className='shrink-0' onClick={onHide}>
              <RiCloseLine className='h-4 w-4' />
            </ActionButton>
          </div>
          <div className='text-text-tertiary system-xs-regular mt-0.5'>
            <span>{t(`${prefixSettings}.modalTip`)}</span>
            <Link href={`${locale === LanguagesSupported[1] ? 'https://docs.dify.ai/zh-hans/guides/application-publishing/launch-your-webapp-quickly#she-zhi-ni-de-ai-zhan-dian' : 'https://docs.dify.ai/guides/application-publishing/launch-your-webapp-quickly#setting-up-your-ai-site'}`} target='_blank' rel='noopener noreferrer' className='text-text-accent'>{t('common.operation.learnMore')}</Link>
          </div>
        </div>
        {/* form body */}
        <div className='space-y-5 px-6 py-3'>
          {/* name & icon */}
          <div className='flex gap-4'>
            <div className='grow'>
              <div className={cn('text-text-secondary system-sm-semibold mb-1 py-1')}>{t(`${prefixSettings}.webName`)}</div>
              <Input
                className='w-full'
                value={inputInfo.title}
                onChange={onChange('title')}
                placeholder={t('app.appNamePlaceholder') || ''}
              />
            </div>
            <AppIcon
              size='xxl'
              onClick={() => { setShowAppIconPicker(true) }}
              className='mt-2 cursor-pointer'
              iconType={appIcon.type}
              icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
              background={appIcon.type === 'image' ? undefined : appIcon.background}
              imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            />
          </div>
          {/* description */}
          <div className='relative'>
            <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.webDesc`)}</div>
            <Textarea
              className='mt-1'
              value={inputInfo.desc}
              onChange={e => onDesChange(e.target.value)}
              placeholder={t(`${prefixSettings}.webDescPlaceholder`) as string}
            />
            <p className={cn('text-text-tertiary body-xs-regular pb-0.5')}>{t(`${prefixSettings}.webDescTip`)}</p>
          </div>
          <Divider className="my-0 h-px" />
          {/* answer icon */}
          {isChat && (
            <div className='w-full'>
              <div className='flex items-center justify-between'>
                <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t('app.answerIcon.title')}</div>
                <Switch
                  defaultValue={inputInfo.use_icon_as_answer_icon}
                  onChange={v => setInputInfo({ ...inputInfo, use_icon_as_answer_icon: v })}
                />
              </div>
              <p className='text-text-tertiary body-xs-regular pb-0.5'>{t('app.answerIcon.description')}</p>
            </div>
          )}
          {/* language */}
          <div className='flex items-center'>
            <div className={cn('text-text-secondary system-sm-semibold grow py-1')}>{t(`${prefixSettings}.language`)}</div>
            <SimpleSelect
              wrapperClassName='w-[200px]'
              items={languages.filter(item => item.supported)}
              defaultValue={language}
              onSelect={item => setLanguage(item.value as Language)}
              notClearable
            />
          </div>
          {/* theme color */}
          {isChat && (
            <div className='flex items-center'>
              <div className='grow'>
                <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.chatColorTheme`)}</div>
                <div className='body-xs-regular text-text-tertiary pb-0.5'>{t(`${prefixSettings}.chatColorThemeDesc`)}</div>
              </div>
              <div className='shrink-0'>
                <Input
                  className='mb-1 w-[200px]'
                  value={inputInfo.chatColorTheme ?? ''}
                  onChange={onChange('chatColorTheme')}
                  placeholder='E.g #A020F0'
                />
                <div className='flex items-center justify-between'>
                  <p className={cn('body-xs-regular text-text-tertiary')}>{t(`${prefixSettings}.chatColorThemeInverted`)}</p>
                  <Switch defaultValue={inputInfo.chatColorThemeInverted} onChange={v => setInputInfo({ ...inputInfo, chatColorThemeInverted: v })}></Switch>
                </div>
              </div>
            </div>
          )}
          {/* workflow detail */}
          <div className='w-full'>
            <div className='flex items-center justify-between'>
              <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.workflow.subTitle`)}</div>
              <Switch
                disabled={!(appInfo.mode === 'workflow' || appInfo.mode === 'advanced-chat')}
                defaultValue={inputInfo.show_workflow_steps}
                onChange={v => setInputInfo({ ...inputInfo, show_workflow_steps: v })}
              />
            </div>
            <p className='text-text-tertiary body-xs-regular pb-0.5'>{t(`${prefixSettings}.workflow.showDesc`)}</p>
          </div>
          {/* SSO */}
          {systemFeatures.enable_web_sso_switch_component && (
            <>
              <Divider className="my-0 h-px" />
              <div className='w-full'>
                <p className='system-xs-medium-uppercase text-text-tertiary mb-1'>{t(`${prefixSettings}.sso.label`)}</p>
                <div className='flex items-center justify-between'>
                  <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.sso.title`)}</div>
                  <Tooltip
                    disabled={systemFeatures.sso_enforced_for_web}
                    popupContent={
                      <div className='w-[180px]'>{t(`${prefixSettings}.sso.tooltip`)}</div>
                    }
                    asChild={false}
                  >
                    <Switch disabled={!systemFeatures.sso_enforced_for_web || !isCurrentWorkspaceEditor} defaultValue={systemFeatures.sso_enforced_for_web && inputInfo.enable_sso} onChange={v => setInputInfo({ ...inputInfo, enable_sso: v })}></Switch>
                  </Tooltip>
                </div>
                <p className='body-xs-regular text-text-tertiary pb-0.5'>{t(`${prefixSettings}.sso.description`)}</p>
              </div>
            </>
          )}
          {/* more settings switch */}
          <Divider className="my-0 h-px" />
          {!isShowMore && (
            <div className='flex cursor-pointer items-center' onClick={() => setIsShowMore(true)}>
              <div className='grow'>
                <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.more.entry`)}</div>
                <p className={cn('text-text-tertiary body-xs-regular pb-0.5')}>{t(`${prefixSettings}.more.copyRightPlaceholder`)} & {t(`${prefixSettings}.more.privacyPolicyPlaceholder`)}</p>
              </div>
              <RiArrowRightSLine className='text-text-secondary ml-1 h-4 w-4 shrink-0' />
            </div>
          )}
          {/* more settings */}
          {isShowMore && (
            <>
              {/* copyright */}
              <div className='w-full'>
                <div className='flex items-center'>
                  <div className='flex grow items-center'>
                    <div className={cn('text-text-secondary system-sm-semibold mr-1 py-1')}>{t(`${prefixSettings}.more.copyright`)}</div>
                    {/* upgrade button */}
                    {enableBilling && isFreePlan && (
                      <div className='h-[18px] select-none'>
                        <PremiumBadge size='s' color='blue' allowHover={true} onClick={handlePlanClick}>
                          <SparklesSoft className='text-components-premium-badge-indigo-text-stop-0 flex h-3.5 w-3.5 items-center py-[1px] pl-[3px]' />
                          <div className='system-xs-medium'>
                            <span className='p-1'>
                              {t('billing.upgradeBtn.encourageShort')}
                            </span>
                          </div>
                        </PremiumBadge>
                      </div>
                    )}
                  </div>
                  <Tooltip
                    disabled={!isFreePlan}
                    popupContent={
                      <div className='w-[260px]'>{t(`${prefixSettings}.more.copyrightTooltip`)}</div>
                    }
                    asChild={false}
                  >
                    <Switch
                      disabled={isFreePlan}
                      defaultValue={inputInfo.copyrightSwitchValue}
                      onChange={v => setInputInfo({ ...inputInfo, copyrightSwitchValue: v })}
                    />
                  </Tooltip>
                </div>
                <p className='text-text-tertiary body-xs-regular pb-0.5'>{t(`${prefixSettings}.more.copyrightTip`)}</p>
                {inputInfo.copyrightSwitchValue && (
                  <Input
                    className='mt-2 h-10'
                    value={inputInfo.copyright}
                    onChange={onChange('copyright')}
                    placeholder={t(`${prefixSettings}.more.copyRightPlaceholder`) as string}
                  />
                )}
              </div>
              {/* privacy policy */}
              <div className='w-full'>
                <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.more.privacyPolicy`)}</div>
                <p className={cn('body-xs-regular text-text-tertiary pb-0.5')}>
                  <Trans
                    i18nKey={`${prefixSettings}.more.privacyPolicyTip`}
                    components={{ privacyPolicyLink: <Link href={'https://docs.dify.ai/user-agreement/privacy-policy'} target='_blank' rel='noopener noreferrer' className='text-text-accent' /> }}
                  />
                </p>
                <Input
                  className='mt-1'
                  value={inputInfo.privacyPolicy}
                  onChange={onChange('privacyPolicy')}
                  placeholder={t(`${prefixSettings}.more.privacyPolicyPlaceholder`) as string}
                />
              </div>
              {/* custom disclaimer */}
              <div className='w-full'>
                <div className={cn('text-text-secondary system-sm-semibold py-1')}>{t(`${prefixSettings}.more.customDisclaimer`)}</div>
                <p className={cn('body-xs-regular text-text-tertiary pb-0.5')}>{t(`${prefixSettings}.more.customDisclaimerTip`)}</p>
                <Textarea
                  className='mt-1'
                  value={inputInfo.customDisclaimer}
                  onChange={onChange('customDisclaimer')}
                  placeholder={t(`${prefixSettings}.more.customDisclaimerPlaceholder`) as string}
                />
              </div>
            </>
          )}
        </div>
        {/* footer */}
        <div className='flex justify-end p-6 pt-5'>
          <Button className='mr-2' onClick={onHide}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={onClickSave} loading={saveLoading}>{t('common.operation.save')}</Button>
        </div>
      </Modal >
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={(payload) => {
            setAppIcon(payload)
            setShowAppIconPicker(false)
          }}
          onClose={() => {
            setAppIcon(icon_type === 'image'
              ? { type: 'image', url: icon_url!, fileId: icon }
              : { type: 'emoji', icon, background: icon_background! })
            setShowAppIconPicker(false)
          }}
        />
      )}
    </>

  )
}
export default React.memo(SettingsModal)
