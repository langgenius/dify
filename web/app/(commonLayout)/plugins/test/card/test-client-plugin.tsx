'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { extensionDallE } from '@/app/components/plugins/card/card-mock'
import PluginItem from '@/app/components/plugins/plugin-item'
import I18n from '@/context/i18n'

const TestClientPlugin = () => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  return (
    <PluginItem
      payload={extensionDallE as any}
      onDelete={() => { }}
      pluginI8n={t}
      locale={locale}
    />
  )
}
export default React.memo(TestClientPlugin)
