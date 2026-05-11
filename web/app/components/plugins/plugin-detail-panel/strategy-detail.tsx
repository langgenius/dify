'use client'
import type { FC } from 'react'
import type {
  StrategyDetail as StrategyDetailType,
} from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import {
  RiArrowLeftLine,
  RiCloseLine,
} from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Divider from '@/app/components/base/divider'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import { API_PREFIX } from '@/config'
import { useRenderI18nObject } from '@/hooks/use-i18n'

type Props = {
  provider: {
    author: string
    name: string
    description: Record<Locale, string>
    tenant_id: string
    icon: string
    label: Record<Locale, string>
    tags: string[]
  }
  detail: StrategyDetailType
  onHide: () => void
}

const StrategyDetail: FC<Props> = ({
  provider,
  detail,
  onHide,
}) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation()

  const outputSchema = useMemo(() => {
    const res: any[] = []
    if (!detail.output_schema || !detail.output_schema.properties)
      return []
    Object.keys(detail.output_schema.properties).forEach((outputKey) => {
      const output = detail.output_schema.properties[outputKey]
      res.push({
        name: outputKey,
        type: output.type === 'array'
          ? `Array[${output.items?.type ? output.items.type.slice(0, 1).toLocaleUpperCase() + output.items.type.slice(1) : 'Unknown'}]`
          : `${output.type ? output.type.slice(0, 1).toLocaleUpperCase() + output.type.slice(1) : 'Unknown'}`,
        description: output.description,
      })
    })
    return res
  }, [detail.output_schema])

  const getType = (type: string) => {
    if (type === 'number-input')
      return t('setBuiltInTools.number', { ns: 'tools' })
    if (type === 'text-input')
      return t('setBuiltInTools.string', { ns: 'tools' })
    if (type === 'checkbox')
      return 'boolean'
    if (type === 'file')
      return t('setBuiltInTools.file', { ns: 'tools' })
    if (type === 'array[tools]')
      return 'multiple-tool-select'
    return type
  }

  return (
    <Drawer
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className={cn('justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-[420px] data-[swipe-direction=right]:max-w-[420px] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border')}>
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              {/* header */}
              <div className="relative border-b border-divider-subtle p-4 pb-3">
                <div className="absolute top-3 right-3">
                  <ActionButton onClick={onHide}>
                    <RiCloseLine className="h-4 w-4" />
                  </ActionButton>
                </div>
                <div
                  className="mb-2 flex cursor-pointer items-center gap-1 system-xs-semibold-uppercase text-text-accent-secondary"
                  onClick={onHide}
                >
                  <RiArrowLeftLine className="h-4 w-4" />
                  BACK
                </div>
                <div className="flex items-center gap-1">
                  <Icon size="tiny" className="h-6 w-6" src={`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${provider.tenant_id}&filename=${provider.icon}`} />
                  <div className="">{getValueFromI18nObject(provider.label)}</div>
                </div>
                <div className="mt-1 system-md-semibold text-text-primary">{getValueFromI18nObject(detail.identity.label)}</div>
                <Description className="mt-3" text={getValueFromI18nObject(detail.description)} descriptionLineRows={2}></Description>
              </div>
              {/* form */}
              <div className="h-full">
                <div className="flex h-full flex-col overflow-y-auto">
                  <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">{t('setBuiltInTools.parameters', { ns: 'tools' })}</div>
                  <div className="px-4">
                    {detail.parameters.length > 0 && (
                      <div className="space-y-1 py-2">
                        {detail.parameters.map((item: any, index) => (
                          <div key={index} className="py-1">
                            <div className="flex items-center gap-2">
                              <div className="code-sm-semibold text-text-secondary">{getValueFromI18nObject(item.label)}</div>
                              <div className="system-xs-regular text-text-tertiary">
                                {getType(item.type)}
                              </div>
                              {item.required && (
                                <div className="system-xs-medium text-text-warning-secondary">{t('setBuiltInTools.required', { ns: 'tools' })}</div>
                              )}
                            </div>
                            {item.human_description && (
                              <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                {getValueFromI18nObject(item.human_description)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {detail.output_schema && (
                    <>
                      <div className="px-4">
                        <Divider className="mt-2!" />
                      </div>
                      <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">OUTPUT</div>
                      {outputSchema.length > 0 && (
                        <div className="space-y-1 px-4 py-2">
                          {outputSchema.map((outputItem, index) => (
                            <div key={index} className="py-1">
                              <div className="flex items-center gap-2">
                                <div className="code-sm-semibold text-text-secondary">{outputItem.name}</div>
                                <div className="system-xs-regular text-text-tertiary">{outputItem.type}</div>
                              </div>
                              {outputItem.description && (
                                <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                  {outputItem.description}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default StrategyDetail
