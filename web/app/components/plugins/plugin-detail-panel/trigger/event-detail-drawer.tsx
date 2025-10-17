'use client'
import ActionButton from '@/app/components/base/action-button'
import Drawer from '@/app/components/base/drawer'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import { triggerEventParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
// import Split from '@/app/components/workflow/nodes/_base/components/split'
import cn from '@/utils/classnames'
import {
  RiArrowLeftLine,
  RiCloseLine,
} from '@remixicon/react'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { TriggerEvent } from '../../types'

type EventDetailDrawerProps = {
  eventInfo: TriggerEvent
  providerInfo: TriggerProviderApiEntity
  onClose: () => void
}

const getType = (type: string, t: TFunction) => {
  if (type === 'number-input')
    return t('tools.setBuiltInTools.number')
  if (type === 'text-input')
    return t('tools.setBuiltInTools.string')
  if (type === 'checkbox')
    return 'boolean'
  if (type === 'file')
    return t('tools.setBuiltInTools.file')
  return type
}

export const EventDetailDrawer: FC<EventDetailDrawerProps> = (props) => {
  const { eventInfo, providerInfo, onClose } = props
  const language = useLanguage()
  const { t } = useTranslation()
  const parametersSchemas = triggerEventParametersToFormSchemas(eventInfo.parameters)
  const outputVars = Object.entries(eventInfo.output_schema?.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: schema.type || 'string',
    description: schema.description || '',
  }))

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
      <div className='relative border-b border-divider-subtle p-4 pb-3'>
        <div className='absolute right-3 top-3'>
          <ActionButton onClick={onClose}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
        <div
          className='system-xs-semibold-uppercase mb-2 flex cursor-pointer items-center gap-1 text-text-accent-secondary'
          onClick={onClose}
        >
          <RiArrowLeftLine className='h-4 w-4' />
          BACK
        </div>
        <div className='flex items-center gap-1'>
          <Icon size='tiny' className='h-6 w-6' src={providerInfo.icon!} />
          <OrgInfo
            packageNameClassName='w-auto'
            orgName={providerInfo.author}
            packageName={providerInfo.name.split('/').pop() || ''}
          />
        </div>
        <div className='system-md-semibold mt-1 text-text-primary'>{eventInfo?.identity?.label[language]}</div>
        <Description className='mb-2 mt-3 h-auto' text={eventInfo.description[language]} descriptionLineRows={2}></Description>
      </div>
      <div className='flex h-full flex-col'>
        <div className='system-sm-semibold-uppercase p-4 pb-1 text-text-primary'>{t('tools.setBuiltInTools.parameters')}</div>
        <div className='h-0 grow overflow-y-auto px-4'>
          {parametersSchemas.length > 0 && (
            <div className='space-y-1 py-2'>
              {parametersSchemas.map((item, index) => (
                <div key={index} className='py-1'>
                  <div className='flex items-center gap-2'>
                    <div className='code-sm-semibold text-text-secondary'>{item.label[language]}</div>
                    <div className='system-xs-regular text-text-tertiary'>
                      {getType(item.type, t)}
                    </div>
                    {item.required && (
                      <div className='system-xs-medium text-text-warning-secondary'>{t('tools.setBuiltInTools.required')}</div>
                    )}
                  </div>
                  {item.description && (
                    <div className='system-xs-regular mt-0.5 text-text-tertiary'>
                      {item.description?.[language]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* <Split /> */}
        <div className='system-sm-semibold-uppercase p-4 pb-1 pt-0 text-text-primary'>{t('pluginTrigger.events.output')}</div>
        <OutputVars collapsed={false}>
          {outputVars.map(varItem => (
            <VarItem
              key={varItem.name}
              name={varItem.name}
              type={varItem.type}
              description={varItem.description}
            // isIndent={hasObjectOutput}
            />
          ))}
        </OutputVars>
      </div>
    </Drawer>
  )
}
