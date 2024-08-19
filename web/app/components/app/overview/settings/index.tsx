'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import Link from 'next/link'
import { Trans, useTranslation } from 'react-i18next'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import AppIcon from '@/app/components/base/app-icon'
import { SimpleSelect } from '@/app/components/base/select'
import type { AppDetailResponse } from '@/models/app'
import type { AppIconType, Language } from '@/types/app'
import { useToastContext } from '@/app/components/base/toast'
import { languages } from '@/i18n/language'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIconPicker from '@/app/components/base/app-icon-picker'

export type ISettingsModalProps = {
  isChat: boolean
  appInfo: AppDetailResponse
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
}

const prefixSettings = 'appOverview.overview.appInfo.settings'

const SettingsModal: FC<ISettingsModalProps> = ({
  isChat,
  appInfo,
  isShow = false,
  onClose,
  onSave,
}) => {
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
  } = appInfo.site
  const [inputInfo, setInputInfo] = useState({
    title,
    desc: description,
    chatColorTheme: chat_color_theme,
    chatColorThemeInverted: chat_color_theme_inverted,
    copyright,
    privacyPolicy: privacy_policy,
    customDisclaimer: custom_disclaimer,
    show_workflow_steps,
  })
  const [language, setLanguage] = useState(default_language)
  const [saveLoading, setSaveLoading] = useState(false)
  const { t } = useTranslation()

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
    icon_type === 'image'
      ? { type: 'image', url: icon_url!, fileId: icon }
      : { type: 'emoji', icon, background: icon_background! },
  )

  useEffect(() => {
    setInputInfo({
      title,
      desc: description,
      chatColorTheme: chat_color_theme,
      chatColorThemeInverted: chat_color_theme_inverted,
      copyright,
      privacyPolicy: privacy_policy,
      customDisclaimer: custom_disclaimer,
      show_workflow_steps,
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
      copyright: inputInfo.copyright,
      privacy_policy: inputInfo.privacyPolicy,
      custom_disclaimer: inputInfo.customDisclaimer,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
      show_workflow_steps: inputInfo.show_workflow_steps,
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

  return (
    <>
      <Modal
        title={t(`${prefixSettings}.title`)}
        isShow={isShow}
        onClose={onHide}
        className={`${s.settingsModal}`}
      >
        <div className={`mt-6 font-medium ${s.settingTitle} text-gray-900`}>{t(`${prefixSettings}.webName`)}</div>
        <div className='flex mt-2'>
          <AppIcon size='large'
            onClick={() => { setShowAppIconPicker(true) }}
            className='cursor-pointer !mr-3 self-center'
            iconType={appIcon.type}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
          />
          <input className={`flex-grow rounded-lg h-10 box-border px-3 ${s.projectName} bg-gray-100`}
            value={inputInfo.title}
            onChange={onChange('title')}
            placeholder={t('app.appNamePlaceholder') || ''}
          />
        </div>
        <div className={`mt-6 font-medium ${s.settingTitle} text-gray-900 `}>{t(`${prefixSettings}.webDesc`)}</div>
        <p className={`mt-1 ${s.settingsTip} text-gray-500`}>{t(`${prefixSettings}.webDescTip`)}</p>
        <textarea
          rows={3}
          className={`mt-2 pt-2 pb-2 px-3 rounded-lg bg-gray-100 w-full ${s.settingsTip} text-gray-900`}
          value={inputInfo.desc}
          onChange={onChange('desc')}
          placeholder={t(`${prefixSettings}.webDescPlaceholder`) as string}
        />
        <div className={`mt-6 mb-2 font-medium ${s.settingTitle} text-gray-900 `}>{t(`${prefixSettings}.language`)}</div>
        <SimpleSelect
          items={languages.filter(item => item.supported)}
          defaultValue={language}
          onSelect={item => setLanguage(item.value as Language)}
        />
        {(appInfo.mode === 'workflow' || appInfo.mode === 'advanced-chat') && <>
          <div className={`mt-6 mb-2 font-medium ${s.settingTitle} text-gray-900 `}>{t(`${prefixSettings}.workflow.title`)}</div>
          <SimpleSelect
            items={[{ name: t(`${prefixSettings}.workflow.show`), value: 'true' }, { name: t(`${prefixSettings}.workflow.hide`), value: 'false' }]}
            defaultValue={inputInfo.show_workflow_steps ? 'true' : 'false'}
            onSelect={item => setInputInfo({ ...inputInfo, show_workflow_steps: item.value === 'true' })}
          />
        </>}
        {isChat && <> <div className={`mt-8 font-medium ${s.settingTitle} text-gray-900`}>{t(`${prefixSettings}.chatColorTheme`)}</div>
          <p className={`mt-1 ${s.settingsTip} text-gray-500`}>{t(`${prefixSettings}.chatColorThemeDesc`)}</p>
          <input className={`w-full mt-2 rounded-lg h-10 box-border px-3 ${s.projectName} bg-gray-100`}
            value={inputInfo.chatColorTheme ?? ''}
            onChange={onChange('chatColorTheme')}
            placeholder= 'E.g #A020F0'
          />
        </>}
        {!isShowMore && <div className='w-full cursor-pointer mt-8' onClick={() => setIsShowMore(true)}>
          <div className='flex justify-between'>
            <div className={`font-medium ${s.settingTitle} flex-grow text-gray-900`}>{t(`${prefixSettings}.more.entry`)}</div>
            <div className='flex-shrink-0 w-4 h-4 text-gray-500'>
              <ChevronRightIcon />
            </div>
          </div>
          <p className={`mt-1 ${s.policy} text-gray-500`}>{t(`${prefixSettings}.more.copyright`)} & {t(`${prefixSettings}.more.privacyPolicy`)}</p>
        </div>}
        {isShowMore && <>
          <hr className='w-full mt-6' />
          <div className={`mt-6 font-medium ${s.settingTitle} text-gray-900`}>{t(`${prefixSettings}.more.copyright`)}</div>
          <input className={`w-full mt-2 rounded-lg h-10 box-border px-3 ${s.projectName} bg-gray-100`}
            value={inputInfo.copyright}
            onChange={onChange('copyright')}
            placeholder={t(`${prefixSettings}.more.copyRightPlaceholder`) as string}
          />
          <div className={`mt-8 font-medium ${s.settingTitle} text-gray-900`}>{t(`${prefixSettings}.more.privacyPolicy`)}</div>
          <p className={`mt-1 ${s.settingsTip} text-gray-500`}>
            <Trans
              i18nKey={`${prefixSettings}.more.privacyPolicyTip`}
              components={{ privacyPolicyLink: <Link href={'https://docs.dify.ai/user-agreement/privacy-policy'} target='_blank' rel='noopener noreferrer' className='text-primary-600' /> }}
            />
          </p>
          <input className={`w-full mt-2 rounded-lg h-10 box-border px-3 ${s.projectName} bg-gray-100`}
            value={inputInfo.privacyPolicy}
            onChange={onChange('privacyPolicy')}
            placeholder={t(`${prefixSettings}.more.privacyPolicyPlaceholder`) as string}
          />
          <div className={`mt-8 font-medium ${s.settingTitle} text-gray-900`}>{t(`${prefixSettings}.more.customDisclaimer`)}</div>
          <p className={`mt-1 ${s.settingsTip} text-gray-500`}>{t(`${prefixSettings}.more.customDisclaimerTip`)}</p>
          <input className={`w-full mt-2 rounded-lg h-10 box-border px-3 ${s.projectName} bg-gray-100`}
            value={inputInfo.customDisclaimer}
            onChange={onChange('customDisclaimer')}
            placeholder={t(`${prefixSettings}.more.customDisclaimerPlaceholder`) as string}
          />
        </>}
        <div className='mt-10 flex justify-end'>
          <Button className='mr-2' onClick={onHide}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={onClickSave} loading={saveLoading}>{t('common.operation.save')}</Button>
        </div>
        {showAppIconPicker && <AppIconPicker
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
        />}
      </Modal >
    </>

  )
}
export default React.memo(SettingsModal)
