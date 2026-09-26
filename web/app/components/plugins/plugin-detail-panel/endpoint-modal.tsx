'use client'
import type {
  EndpointProviderConfigI18nResponse,
  EndpointProviderConfigResponse,
  EndpointUpdatePayload,
  ProviderConfigType,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  CredentialFormSchema,
  TypeWithI18N,
} from '../../header/account-setting/model-provider-page/declarations'
import type { PluginDetail } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { toast } from '@/app/notifications'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { FormTypeEnum } from '../../header/account-setting/model-provider-page/declarations'
import { ReadmeEntrance } from '../readme-panel/entrance'

const NAME_FIELD = {
  type: 'text-input',
  name: 'name',
  label: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  placeholder: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  required: true,
  default: '',
  help: null,
} satisfies EndpointProviderConfigResponse

type Props = Readonly<{
  settings: EndpointProviderConfigResponse[]
  defaultValues?: Record<string, unknown>
  onCancel: () => void
  onSaved: (value: EndpointUpdatePayload) => void
  isPending?: boolean
  pluginDetail: PluginDetail
}>

const fieldTypes: Record<ProviderConfigType, FormTypeEnum> = {
  'text-input': FormTypeEnum.textInput,
  'secret-input': FormTypeEnum.secretInput,
  select: FormTypeEnum.select,
  boolean: FormTypeEnum.checkbox,
  'app-selector': FormTypeEnum.appSelector,
  'model-selector': FormTypeEnum.modelSelector,
  'array[tools]': FormTypeEnum.multiToolSelector,
}

const toFormLabel = (label: EndpointProviderConfigI18nResponse): TypeWithI18N => ({
  en_US: label.en_US,
  zh_Hans: label.zh_Hans ?? label.en_US,
  pt_BR: label.pt_BR ?? label.en_US,
  ja_JP: label.ja_JP ?? label.en_US,
})

const toFormSchema = (field: EndpointProviderConfigResponse): CredentialFormSchema => ({
  name: field.name,
  variable: field.name,
  type: fieldTypes[field.type],
  label: toFormLabel(field.label ?? { en_US: field.name }),
  required: field.required ?? false,
  show_on: [],
  tooltip: field.help ? toFormLabel(field.help) : undefined,
  placeholder: field.placeholder ? toFormLabel(field.placeholder) : undefined,
  scope: field.scope ?? undefined,
  url: field.url ?? undefined,
  options: (field.options ?? []).map((option) => ({
    value: option.value,
    label: toFormLabel(option.label),
    show_on: [],
  })),
})

const EndpointModal = ({
  settings,
  defaultValues,
  onCancel,
  onSaved,
  isPending,
  pluginDetail,
}: Props) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation(['common', 'plugin', 'tools'])
  const fields = [NAME_FIELD, ...settings]
  const formSchemas = fields.map(toFormSchema)
  const [tempCredential, setTempCredential] = React.useState<Record<string, unknown>>(() => {
    const values: Record<string, unknown> = {
      ...Object.fromEntries(
        fields
          .filter((field) => field.default !== undefined)
          .map((field) => [field.name, field.default]),
      ),
      ...defaultValues,
    }
    for (const field of fields) {
      const value = values[field.name]
      if (field.type !== 'boolean' || (field.required && value === '')) continue
      if (typeof value === 'string')
        values[field.name] = value === 'true' || value === '1' || value === 'True'
      else if (typeof value === 'number') values[field.name] = value === 1
    }
    return values
  })

  const handleSave = () => {
    if (isPending) return
    for (const field of fields) {
      const value = tempCredential[field.name]
      if (field.required && (value === undefined || value === null || value === '')) {
        toast.error(
          t(($) => $['errorMsg.fieldRequired'], {
            ns: 'common',
            field: field.label ? getValueFromI18nObject(toFormLabel(field.label)) : field.name,
          }),
        )
        return
      }
    }
    const { name, ...values } = tempCredential
    if (typeof name !== 'string' || name.length === 0) return
    onSaved({ name, settings: values })
  }

  return (
    <Drawer
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-black/30" />
        <DrawerViewport>
          <DrawerPopup
            className={cn(
              'justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-100 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border',
            )}
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <div className="system-xl-semibold text-text-primary">
                    {t(($) => $['detailPanel.endpointModalTitle'], { ns: 'plugin' })}
                  </div>
                  <IconButton
                    aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                    onClick={onCancel}
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </IconButton>
                </div>
                <div className="mt-0.5 system-xs-regular text-text-tertiary">
                  {t(($) => $['detailPanel.endpointModalDesc'], { ns: 'plugin' })}
                </div>
                <ReadmeEntrance pluginDetail={pluginDetail} className="px-0 pt-3" />
              </div>
              <form
                className="grow overflow-y-auto"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleSave()
                }}
              >
                <div className="px-4 py-2">
                  <Form
                    value={tempCredential}
                    onChange={(v) => {
                      setTempCredential(v)
                    }}
                    formSchemas={formSchemas}
                    isEditMode={true}
                    showOnVariableMap={{}}
                    validating={false}
                    inputClassName="bg-components-input-bg-normal hover:bg-components-input-bg-hover"
                    fieldMoreInfo={(item) =>
                      item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center body-xs-regular text-text-accent-secondary"
                        >
                          {t(($) => $.howToGet, { ns: 'tools' })}
                          <span aria-hidden className="ml-1 i-ri-arrow-right-up-line size-3" />
                        </a>
                      ) : null
                    }
                  />
                </div>
                <div className={cn('flex justify-end p-4 pt-0')}>
                  <div className="flex gap-2">
                    <Button onClick={onCancel}>
                      {t(($) => $['operation.cancel'], { ns: 'common' })}
                    </Button>
                    <Button variant="primary" type="submit" loading={isPending}>
                      {t(($) => $['operation.save'], { ns: 'common' })}
                    </Button>
                  </div>
                </div>
              </form>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default React.memo(EndpointModal)
