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
import type { Language } from '@/types/app'
import EmojiPicker from '@/app/components/base/emoji-picker'
import { useToastContext } from '@/app/components/base/toast'

import { languages } from '@/i18n/language'

export type ISettingsModalProps = {
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
  prompt_public: boolean
  copyright: string
  privacy_policy: string
  icon: string
  icon_background: string
}

const prefixSettings = 'appOverview.overview.appInfo.settings'

const SettingsModal: FC<ISettingsModalProps> = ({
  appInfo,
  isShow = false,
  onClose,
  onSave,
}) => {
  const { notify } = useToastContext()
  const [isShowMore, setIsShowMore] = useState(false)
  const { icon, icon_background } = appInfo
  const { title, description, copyright, privacy_policy, default_language } = appInfo.site
  const [inputInfo, setInputInfo] = useState({ title, desc: description, copyright, privacyPolicy: privacy_policy })
  const [language, setLanguage] = useState(default_language)
  const [saveLoading, setSaveLoading] = useState(false)
  const { t } = useTranslation()
  // Emoji Picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon, icon_background })

  useEffect(() => {
    setInputInfo({ title, desc: description, copyright, privacyPolicy: privacy_policy })
    setLanguage(default_language)
    setEmoji({ icon, icon_background })
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
    setSaveLoading(true)
    const params = {
      title: inputInfo.title,
      description: inputInfo.desc,
      default_language: language,
      prompt_public: false,
      copyright: inputInfo.copyright,
      privacy_policy: inputInfo.privacyPolicy,
      icon: emoji.icon,
      icon_background: emoji.icon_background,
    }
    await onSave?.(params)
    setSaveLoading(false)
    onHide()
  }

  const onChange = (field: string) => {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInputInfo(item => ({ ...item, [field]: e.target.value }))
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
            onClick={() => { setShowEmojiPicker(true) }}
            className='cursor-pointer !mr-3 self-center'
            icon={emoji.icon}
            background={emoji.icon_background}
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
        </>}
        <div className='mt-10 flex justify-end'>
          <Button className='mr-2 flex-shrink-0 !text-sm' onClick={onHide}>{t('common.operation.cancel')}</Button>
          <Button type='primary' className='flex-shrink-0 !text-sm' onClick={onClickSave} loading={saveLoading}>{t('common.operation.save')}</Button>
        </div>
        {showEmojiPicker && <EmojiPicker
          onSelect={(icon, icon_background) => {
            setEmoji({ icon, icon_background })
            setShowEmojiPicker(false)
          }}
          onClose={() => {
            setEmoji({ icon: appInfo.site.icon, icon_background: appInfo.site.icon_background })
            setShowEmojiPicker(false)
          }}
        />}
      </Modal >
    </>

  )
}
export default React.memo(SettingsModal)
