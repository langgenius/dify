import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import SerpapiLogo from '../../assets/serpapi.png'
import KeyValidator from '../key-validator'
import type { Form, ValidateValue } from '../key-validator/declarations'
import { updatePluginKey, validatePluginKey } from './utils'
import { useToastContext } from '@/app/components/base/toast'
import type { PluginProvider } from '@/models/common'
import { useAppContext } from '@/context/app-context'

type SerpapiPluginProps = {
  plugin: PluginProvider
  onUpdate: () => void
}
const SerpapiPlugin = ({
  plugin,
  onUpdate,
}: SerpapiPluginProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { notify } = useToastContext()

  const forms: Form[] = [{
    key: 'api_key',
    title: t('common.plugin.serpapi.apiKey'),
    placeholder: t('common.plugin.serpapi.apiKeyPlaceholder'),
    value: plugin.credentials?.api_key,
    validate: {
      before: (v) => {
        if (v?.api_key)
          return true
      },
      run: async (v) => {
        return validatePluginKey('serpapi', {
          credentials: {
            api_key: v?.api_key,
          },
        })
      },
    },
    handleFocus: (v, dispatch) => {
      if (v.api_key === plugin.credentials?.api_key)
        dispatch({ ...v, api_key: '' })
    },
  }]

  const handleSave = async (v: ValidateValue) => {
    if (!v?.api_key || v?.api_key === plugin.credentials?.api_key)
      return

    const res = await updatePluginKey('serpapi', {
      credentials: {
        api_key: v?.api_key,
      },
    })

    if (res.status === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onUpdate()
      return true
    }
  }

  return (
    <KeyValidator
      type='serpapi'
      title={<Image alt='serpapi logo' src={SerpapiLogo} width={64} />}
      status={plugin.credentials?.api_key ? 'success' : 'add'}
      forms={forms}
      keyFrom={{
        text: t('common.plugin.serpapi.keyFrom'),
        link: 'https://serpapi.com/manage-api-key',
      }}
      onSave={handleSave}
      disabled={!isCurrentWorkspaceManager}
    />
  )
}

export default SerpapiPlugin
