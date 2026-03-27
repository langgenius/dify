import type { FC } from 'react'
import type { ExternalDataToolProvider as Provider } from './helpers'
import type {
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
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/base/ui/select'
import { toast } from '@/app/components/base/ui/toast'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { useDocLink, useLocale } from '@/context/i18n'
import { useCodeBasedExtensions } from '@/service/use-common'
import {
  formatExternalDataToolForSave,
  getExternalDataToolDefaultConfig,
  getExternalDataToolValidationError,
  getInitialExternalDataTool,

  SYSTEM_EXTERNAL_DATA_TOOL_TYPES,
} from './helpers'

type ExternalDataToolModalProps = {
  data: ExternalDataTool
  onCancel: () => void
  onSave: (externalDataTool: ExternalDataTool) => void
  onValidateBeforeSave?: (externalDataTool: ExternalDataTool) => boolean
}
const ExternalDataToolModal: FC<ExternalDataToolModalProps> = ({
  data,
  onCancel,
  onSave,
  onValidateBeforeSave,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const locale = useLocale()
  const [localeData, setLocaleData] = useState(getInitialExternalDataTool(data))
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
    setLocaleData({
      ...localeData,
      type,
      config: getExternalDataToolDefaultConfig(type, providers),
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

  const handleSave = () => {
    const validationError = getExternalDataToolValidationError({
      localeData,
      currentProvider,
      locale,
    })
    if (validationError) {
      const translatedLabel = validationError.label.includes('.')
        ? t(validationError.label, validationError.label, { ns: 'appDebug' })
        : validationError.label

      if (validationError.kind === 'invalid')
        toast.error(t('varKeyError.notValid', { ns: 'appDebug', key: translatedLabel }))
      else
        toast.error(t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: translatedLabel }))
      return
    }

    const formattedData = formatExternalDataToolForSave(localeData, currentProvider, data.type ? !!data.enabled : true)

    if (onValidateBeforeSave && !onValidateBeforeSave(formattedData))
      return

    onSave(formatExternalDataToolForSave(formattedData, currentProvider, !!formattedData.enabled))
  }

  const action = data.type ? t('operation.edit', { ns: 'common' }) : t('operation.add', { ns: 'common' })

  return (
    <Dialog
      open
      onOpenChange={noop}
    >
      <DialogContent className="!w-[640px] !max-w-none !p-8 !pb-6">
        <div className="mb-2 text-xl font-semibold text-text-primary">
          {`${action} ${t('variableConfig.apiBasedVar', { ns: 'appDebug' })}`}
        </div>
        <div className="py-2">
          <div className="text-sm font-medium leading-9 text-text-primary">
            {t('apiBasedExtension.type', { ns: 'common' })}
          </div>
          <Select
            defaultValue={localeData.type}
            onValueChange={value => value && handleDataTypeChange(value)}
          >
            <SelectTrigger className="w-full" aria-label={t('apiBasedExtension.type', { ns: 'common' })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent popupClassName="w-[354px]">
              {providers.map(option => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              className="!h-9 !w-9 cursor-pointer rounded-lg border-[0.5px] border-components-panel-border"
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
          !SYSTEM_EXTERNAL_DATA_TOOL_TYPES.includes(localeData.type as typeof SYSTEM_EXTERNAL_DATA_TOOL_TYPES[number])
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
      </DialogContent>
    </Dialog>
  )
}

export default ExternalDataToolModal
