'use client'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { TriggerEvent } from '@/app/components/plugins/types'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import {
  RiArrowLeftLine,
  RiCloseLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Divider from '@/app/components/base/divider'
import Drawer from '@/app/components/base/drawer'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import { triggerEventParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import Field from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show/field'
import { cn } from '@/utils/classnames'

type EventDetailDrawerProps = {
  eventInfo: TriggerEvent
  providerInfo: TriggerProviderApiEntity
  onClose: () => void
}

const getType = (type: string, t: TFunction) => {
  if (type === 'number-input')
    return t('setBuiltInTools.number', { ns: 'tools' })
  if (type === 'text-input')
    return t('setBuiltInTools.string', { ns: 'tools' })
  if (type === 'checkbox')
    return 'boolean'
  if (type === 'file')
    return t('setBuiltInTools.file', { ns: 'tools' })
  return type
}

// Convert JSON Schema to StructuredOutput format
const convertSchemaToField = (schema: any): any => {
  const field: any = {
    type: Array.isArray(schema.type) ? schema.type[0] : schema.type || 'string',
  }

  if (schema.description)
    field.description = schema.description

  if (schema.properties) {
    field.properties = Object.entries(schema.properties).reduce((acc, [key, value]: [string, any]) => ({
      ...acc,
      [key]: convertSchemaToField(value),
    }), {})
  }

  if (schema.required)
    field.required = schema.required

  if (schema.items)
    field.items = convertSchemaToField(schema.items)

  if (schema.enum)
    field.enum = schema.enum

  return field
}

export const EventDetailDrawer: FC<EventDetailDrawerProps> = (props) => {
  const { eventInfo, providerInfo, onClose } = props
  const language = useLanguage()
  const { t } = useTranslation()
  const parametersSchemas = triggerEventParametersToFormSchemas(eventInfo.parameters)

  // Convert output_schema properties to array for direct rendering
  const outputFields = eventInfo.output_schema?.properties
    ? Object.entries(eventInfo.output_schema.properties).map(([name, schema]: [string, any]) => ({
        name,
        field: convertSchemaToField(schema),
        required: eventInfo.output_schema.required?.includes(name) || false,
      }))
    : []

  return (
    <Drawer
      isOpen
      clickOutsideNotOpen={false}
      onClose={onClose}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      <div className="relative border-b border-divider-subtle p-4 pb-3">
        <div className="absolute right-3 top-3">
          <ActionButton onClick={onClose}>
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
        <div
          className="system-xs-semibold-uppercase mb-2 flex cursor-pointer items-center gap-1 text-text-accent-secondary"
          onClick={onClose}
        >
          <RiArrowLeftLine className="h-4 w-4" />
          {t('detailPanel.operation.back', { ns: 'plugin' })}
        </div>
        <div className="flex items-center gap-1">
          <Icon size="tiny" className="h-6 w-6" src={providerInfo.icon!} />
          <OrgInfo
            packageNameClassName="w-auto"
            orgName={providerInfo.author}
            packageName={providerInfo.name.split('/').pop() || ''}
          />
        </div>
        <div className="system-md-semibold mt-1 text-text-primary">{eventInfo?.identity?.label[language]}</div>
        <Description className="mb-2 mt-3 h-auto" text={eventInfo.description[language]} descriptionLineRows={2}></Description>
      </div>
      <div className="flex h-full flex-col gap-2 overflow-y-auto px-4 pb-2 pt-4">
        <div className="system-sm-semibold-uppercase text-text-secondary">{t('setBuiltInTools.parameters', { ns: 'tools' })}</div>
        {parametersSchemas.length > 0
          ? (
              parametersSchemas.map((item, index) => (
                <div key={index} className="py-1">
                  <div className="flex items-center gap-2">
                    <div className="code-sm-semibold text-text-secondary">{item.label[language]}</div>
                    <div className="system-xs-regular text-text-tertiary">
                      {getType(item.type, t)}
                    </div>
                    {item.required && (
                      <div className="system-xs-medium text-text-warning-secondary">{t('setBuiltInTools.required', { ns: 'tools' })}</div>
                    )}
                  </div>
                  {item.description && (
                    <div className="system-xs-regular mt-0.5 text-text-tertiary">
                      {item.description?.[language]}
                    </div>
                  )}
                </div>
              ))
            )
          : <div className="system-xs-regular text-text-tertiary">{t('events.item.noParameters', { ns: 'pluginTrigger' })}</div>}
        <Divider className="mb-2 mt-1 h-px" />
        <div className="flex flex-col gap-2">
          <div className="system-sm-semibold-uppercase text-text-secondary">{t('events.output', { ns: 'pluginTrigger' })}</div>
          <div className="relative left-[-7px]">
            {outputFields.map(item => (
              <Field
                key={item.name}
                name={item.name}
                payload={item.field}
                required={item.required}
                rootClassName="code-sm-semibold text-text-secondary"
              />
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  )
}
