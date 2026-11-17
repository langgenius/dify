import type { FC } from 'react'
import type { ExternalDataTool } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogClose, DialogFooter } from '@langgenius/dify-ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { toast } from '@/app/components/app/configuration/toast'
import FormGeneration from '@/app/components/base/features/new-feature-panel/moderation/form-generation'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import { ApiBasedExtensionSelector } from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { useDocLink } from '@/context/i18n'
import { codeBasedExtensionsQueryOptions } from '@/features/code-based-extension/query'
import {
  buildProviders,
  formatExternalDataTool,
  getProviderDefaultConfig,
  getValidationError,
} from './external-data-tool-modal-utils'

type ExternalDataToolModalProps = {
  data?: ExternalDataTool
  onSave: (externalDataTool: ReturnType<typeof formatExternalDataTool>) => void
  isVariableUsed: (name: string) => boolean
}
const ExternalDataToolModal: FC<ExternalDataToolModalProps> = ({
  data = {},
  onSave,
  isVariableUsed,
}) => {
  const { t } = useTranslation(['appDebug', 'common', 'app'])
  const docLink = useDocLink()
  const locale = useLocale()
  const nameId = useId()
  const variableId = useId()
  const [localeData, setLocaleData] = useState(() => ({
    ...data,
    type: data.type || 'api',
    label: data.label ?? '',
    variable: data.variable ?? '',
  }))
  const { data: codeBasedExtensionList } = useQuery(
    codeBasedExtensionsQueryOptions('external_data_tool'),
  )

  const providers = buildProviders({
    codeBasedExtensionList,
    locale,
    t,
  })
  const currentProvider = providers.find((provider) => provider.key === localeData.type)

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

    if (isVariableUsed(formattedData.variable)) {
      toast.error(
        t(($) => $['varKeyError.keyAlreadyExists'], {
          ns: 'appDebug',
          key: formattedData.variable,
        }),
      )
      return
    }

    onSave(formattedData)
  }

  return (
    <>
      <DialogBody>
        <div className="py-2">
          <div className="text-sm/9 font-medium text-text-primary">
            {t(($) => $['apiBasedExtension.type'], { ns: 'common' })}
          </div>
          <Select
            defaultValue={localeData.type}
            onValueChange={(value) => value && handleDataTypeChange(value)}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t(($) => $['apiBasedExtension.type'], { ns: 'common' })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-88.5">
              {providers.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <SelectItemText>{option.name}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="py-2">
          <label htmlFor={nameId} className="block text-sm/9 font-medium text-text-primary">
            {t(($) => $['feature.tools.modal.name.title'], { ns: 'appDebug' })}
          </label>
          <div className="flex items-center">
            <input
              id={nameId}
              value={localeData.label}
              onChange={(e) => handleValueChange({ label: e.target.value })}
              className="me-2 block h-9 grow appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden"
              placeholder={t(($) => $['feature.tools.modal.name.placeholder'], {
                ns: 'appDebug',
              })}
            />
            <IconPicker
              value={
                localeData.icon
                  ? {
                      type: 'emoji',
                      icon: localeData.icon,
                      background: localeData.icon_background,
                    }
                  : undefined
              }
              onValueChange={(value) => {
                if (value.type !== 'emoji') return
                const { icon, background: icon_background } = value
                handleValueChange({ icon, icon_background })
              }}
            >
              <IconPickerTrigger
                aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                className="shrink-0 cursor-pointer rounded-lg"
              >
                <IconPickerIcon
                  size="large"
                  className="h-9! w-9! rounded-lg border-[0.5px] border-components-panel-border"
                />
              </IconPickerTrigger>
              <IconPickerContent enableImageUpload={false} />
            </IconPicker>
          </div>
        </div>
        <div className="py-2">
          <label htmlFor={variableId} className="block text-sm/9 font-medium text-text-primary">
            {t(($) => $['feature.tools.modal.variableName.title'], { ns: 'appDebug' })}
          </label>
          <input
            id={variableId}
            value={localeData.variable}
            onChange={(e) => handleValueChange({ variable: e.target.value })}
            className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden"
            placeholder={t(($) => $['feature.tools.modal.variableName.placeholder'], {
              ns: 'appDebug',
            })}
          />
        </div>
        {localeData.type === 'api' && (
          <div className="py-2">
            <div className="flex h-9 items-center justify-between text-sm font-medium text-text-primary">
              {t(($) => $['apiBasedExtension.selector.title'], { ns: 'common' })}
              <a
                href={docLink('/use-dify/workspace/api-extension/api-extension')}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center text-xs font-normal text-text-tertiary hover:text-text-accent"
              >
                <span
                  aria-hidden
                  className="me-1 i-custom-vender-line-education-book-open-01 size-3 text-text-tertiary group-hover:text-text-accent"
                />
                {t(($) => $['apiBasedExtension.link'], { ns: 'common' })}
              </a>
            </div>
            <ApiBasedExtensionSelector
              value={localeData.config?.api_based_extension_id || ''}
              onChange={handleDataApiBasedChange}
            />
          </div>
        )}
        {localeData.type !== 'api' && currentProvider?.form_schema && (
          <FormGeneration
            forms={currentProvider?.form_schema}
            value={localeData.config}
            onChange={handleDataExtraChange}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button variant="primary" disabled={!currentProvider} onClick={handleSave}>
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </>
  )
}

export default ExternalDataToolModal
