import type { FC } from 'react'
import type {
  CodeBasedExtensionItem,
  ExternalDataTool,
} from '@/models/common'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import EmojiPicker from '@/app/components/base/emoji-picker'
import FormGeneration from '@/app/components/base/features/new-feature-panel/moderation/form-generation'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import Modal from '@/app/components/base/modal'
import { SimpleSelect } from '@/app/components/base/select'
import { useToastContext } from '@/app/components/base/toast'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { useDocLink, useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { useCodeBasedExtensions } from '@/service/use-common'

const systemTypes = ['api']
type ExternalDataToolModalProps = {
  data: ExternalDataTool
  onCancel: () => void
  onSave: (externalDataTool: ExternalDataTool) => void
  onValidateBeforeSave?: (externalDataTool: ExternalDataTool) => boolean
}
type Provider = {
  key: string
  name: string
  form_schema?: CodeBasedExtensionItem['form_schema']
}
const ExternalDataToolModal: FC<ExternalDataToolModalProps> = ({
  data,
  onCancel,
  onSave,
  onValidateBeforeSave,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { notify } = useToastContext()
  const locale = useLocale()
  const [localeData, setLocaleData] = useState(data.type ? data : { ...data, type: 'api' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { data: codeBasedExtensionList } = useCodeBasedExtensions('external_data_tool')

  const providers: Provider[] = [
    {
      key: 'api',
      name: t('apiBasedExtension.selector.title', { ns: 'common' }),
    },
    ...(
      codeBasedExtensionList
        ? codeBasedExtensionList.data.map((item) => {
            return {
              key: item.name,
              name: locale === 'zh-Hans' ? item.label['zh-Hans'] : item.label['en-US'],
              form_schema: item.form_schema,
            }
          })
        : []
    ),
  ]
  const currentProvider = providers.find(provider => provider.key === localeData.type)

  const handleDataTypeChange = (type: string) => {
    let config: undefined | Record<string, any>
    const currProvider = providers.find(provider => provider.key === type)

    if (systemTypes.findIndex(t => t === type) < 0 && currProvider?.form_schema) {
      config = currProvider?.form_schema.reduce((prev, next) => {
        prev[next.variable] = next.default
        return prev
      }, {} as Record<string, any>)
    }
    setLocaleData({
      ...localeData,
      type,
      config,
    })
  }

  const handleDataExtraChange = (extraValue: Record<string, string>) => {
    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        ...extraValue,
      },
    })
  }

  const handleValueChange = (value: Record<string, string>) => {
    setLocaleData({
      ...localeData,
      ...value,
    })
  }

  const handleDataApiBasedChange = (apiBasedExtensionId: string) => {
    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        api_based_extension_id: apiBasedExtensionId,
      },
    })
  }

  const formatData = (originData: ExternalDataTool) => {
    const { type, config } = originData
    const params: Record<string, string | undefined> = {}

    if (type === 'api')
      params.api_based_extension_id = config?.api_based_extension_id

    if (systemTypes.findIndex(t => t === type) < 0 && currentProvider?.form_schema) {
      currentProvider.form_schema.forEach((form) => {
        params[form.variable] = config?.[form.variable]
      })
    }

    return {
      ...originData,
      type,
      enabled: data.type ? data.enabled : true,
      config: {
        ...params,
      },
    }
  }

  const handleSave = () => {
    if (!localeData.type) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.toolType.title', { ns: 'appDebug' }) }) })
      return
    }

    if (!localeData.label) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.name.title', { ns: 'appDebug' }) }) })
      return
    }

    if (!localeData.variable) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.variableName.title', { ns: 'appDebug' }) }) })
      return
    }

    if (localeData.variable && !/^[a-z_]\w{0,29}$/i.test(localeData.variable)) {
      notify({ type: 'error', message: t('varKeyError.notValid', { ns: 'appDebug', key: t('feature.tools.modal.variableName.title', { ns: 'appDebug' }) }) })
      return
    }

    if (localeData.type === 'api' && !localeData.config?.api_based_extension_id) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale !== LanguagesSupported[1] ? 'API Extension' : 'API 扩展' }) })
      return
    }

    if (systemTypes.findIndex(t => t === localeData.type) < 0 && currentProvider?.form_schema) {
      for (let i = 0; i < currentProvider.form_schema.length; i++) {
        if (!localeData.config?.[currentProvider.form_schema[i].variable] && currentProvider.form_schema[i].required) {
          notify({
            type: 'error',
            message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale !== LanguagesSupported[1] ? currentProvider.form_schema[i].label['en-US'] : currentProvider.form_schema[i].label['zh-Hans'] }),
          })
          return
        }
      }
    }

    const formattedData = formatData(localeData)

    if (onValidateBeforeSave && !onValidateBeforeSave(formattedData))
      return

    onSave(formatData(formattedData))
  }

  const action = data.type ? t('operation.edit', { ns: 'common' }) : t('operation.add', { ns: 'common' })

  return (
    <Modal
      isShow
      onClose={noop}
      className="!w-[640px] !max-w-none !p-8 !pb-6"
    >
      <div className="mb-2 text-xl font-semibold text-text-primary">
        {`${action} ${t('variableConfig.apiBasedVar', { ns: 'appDebug' })}`}
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('apiBasedExtension.type', { ns: 'common' })}
        </div>
        <SimpleSelect
          defaultValue={localeData.type}
          items={providers.map((option) => {
            return {
              value: option.key,
              name: option.name,
            }
          })}
          onSelect={item => handleDataTypeChange(item.value as string)}
        />
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('feature.tools.modal.name.title', { ns: 'appDebug' })}
        </div>
        <div className="flex items-center">
          <input
            value={localeData.label || ''}
            onChange={e => handleValueChange({ label: e.target.value })}
            className="mr-2 block h-9 grow appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-none"
            placeholder={t('feature.tools.modal.name.placeholder', { ns: 'appDebug' }) || ''}
          />
          <AppIcon
            size="large"
            onClick={() => { setShowEmojiPicker(true) }}
            className="!h-9 !w-9 cursor-pointer rounded-lg border-[0.5px] border-components-panel-border "
            icon={localeData.icon}
            background={localeData.icon_background}
          />
        </div>
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('feature.tools.modal.variableName.title', { ns: 'appDebug' })}
        </div>
        <input
          value={localeData.variable || ''}
          onChange={e => handleValueChange({ variable: e.target.value })}
          className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-none"
          placeholder={t('feature.tools.modal.variableName.placeholder', { ns: 'appDebug' }) || ''}
        />
      </div>
      {
        localeData.type === 'api' && (
          <div className="py-2">
            <div className="flex h-9 items-center justify-between text-sm font-medium text-text-primary">
              {t('apiBasedExtension.selector.title', { ns: 'common' })}
              <a
                href={docLink('/use-dify/workspace/api-extension/api-extension')}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center text-xs font-normal text-text-tertiary hover:text-text-accent"
              >
                <BookOpen01 className="mr-1 h-3 w-3 text-text-tertiary group-hover:text-text-accent" />
                {t('apiBasedExtension.link', { ns: 'common' })}
              </a>
            </div>
            <ApiBasedExtensionSelector
              value={localeData.config?.api_based_extension_id || ''}
              onChange={handleDataApiBasedChange}
            />
          </div>
        )
      }
      {
        systemTypes.findIndex(t => t === localeData.type) < 0
        && currentProvider?.form_schema
        && (
          <FormGeneration
            forms={currentProvider?.form_schema}
            value={localeData.config}
            onChange={handleDataExtraChange}
          />
        )
      }
      <div className="mt-6 flex items-center justify-end">
        <Button
          onClick={onCancel}
          className="mr-2"
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
      {
        showEmojiPicker && (
          <EmojiPicker
            onSelect={(icon, icon_background) => {
              handleValueChange({ icon, icon_background })
              setShowEmojiPicker(false)
            }}
            onClose={() => {
              handleValueChange({ icon: '', icon_background: '' })
              setShowEmojiPicker(false)
            }}
          />
        )
      }
    </Modal>
  )
}

export default ExternalDataToolModal
