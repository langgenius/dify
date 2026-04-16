import type { FC } from 'react'
import type {
  ExternalDataTool,
} from '@/models/common'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import FormGeneration from '@/app/components/base/features/new-feature-panel/moderation/form-generation'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import { Button } from '@/app/components/base/ui/button'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from '@/app/components/base/ui/select'
import { toast } from '@/app/components/base/ui/toast'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { useDocLink, useLocale } from '@/context/i18n'
import { useCodeBasedExtensions } from '@/service/use-common'
import {
  buildProviders,
  formatExternalDataTool,
  getProviderDefaultConfig,
  getValidationError,
} from './external-data-tool-modal-utils'

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
  const [localeData, setLocaleData] = useState(data.type ? data : { ...data, type: 'api' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { data: codeBasedExtensionList } = useCodeBasedExtensions('external_data_tool')

  const providers = buildProviders({
    codeBasedExtensionList,
    locale,
    t,
  })
  const currentProvider = providers.find(provider => provider.key === localeData.type)

  const handleDataTypeChange = (type: string) => {
    setLocaleData({
      ...localeData,
      type,
      config: getProviderDefaultConfig(type, providers),
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
    const validationError = getValidationError({
      currentProvider,
      locale,
      localeData,
      t,
    })
    if (validationError) {
      toast.error(validationError)
      return
    }

    const formattedData = formatExternalDataTool(localeData, currentProvider, !!data.type)

    if (onValidateBeforeSave && !onValidateBeforeSave(formattedData))
      return

    onSave(formattedData)
  }

  const action = data.type ? t('operation.edit', { ns: 'common' }) : t('operation.add', { ns: 'common' })

  return (
    <Dialog
      open
      onOpenChange={noop}
    >
      <DialogContent className="w-[640px]! max-w-none! p-8! pb-6!">
        <div className="mb-2 text-xl font-semibold text-text-primary">
          {`${action} ${t('variableConfig.apiBasedVar', { ns: 'appDebug' })}`}
        </div>
        <div className="py-2">
          <div className="text-sm leading-9 font-medium text-text-primary">
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
                  <SelectItemText>{option.name}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="py-2">
          <div className="text-sm leading-9 font-medium text-text-primary">
            {t('feature.tools.modal.name.title', { ns: 'appDebug' })}
          </div>
          <div className="flex items-center">
            <input
              value={localeData.label || ''}
              onChange={e => handleValueChange({ label: e.target.value })}
              className="mr-2 block h-9 grow appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden"
              placeholder={t('feature.tools.modal.name.placeholder', { ns: 'appDebug' }) || ''}
            />
            <AppIcon
              size="large"
              onClick={() => { setShowEmojiPicker(true) }}
              className="h-9! w-9! cursor-pointer rounded-lg border-[0.5px] border-components-panel-border"
              icon={localeData.icon}
              background={localeData.icon_background}
            />
          </div>
        </div>
        <div className="py-2">
          <div className="text-sm leading-9 font-medium text-text-primary">
            {t('feature.tools.modal.variableName.title', { ns: 'appDebug' })}
          </div>
          <input
            value={localeData.variable || ''}
            onChange={e => handleValueChange({ variable: e.target.value })}
            className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden"
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
          localeData.type !== 'api'
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
