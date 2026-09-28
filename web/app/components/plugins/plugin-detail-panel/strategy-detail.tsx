'use client'

import type {
  AgentStrategyEntity,
  AgentStrategyParameterType,
  AgentStrategyProviderIdentity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { RiArrowLeftLine, RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import { API_PREFIX } from '@/config'
import { useRenderI18nObject } from '@/hooks/use-i18n'

type Props = Readonly<{
  provider: AgentStrategyProviderIdentity
  tenantId: string
  detail: AgentStrategyEntity
  onHide: () => void
}>

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getOutputType = (schema: unknown): string => {
  if (!isSchemaObject(schema)) return 'Unknown'
  if (schema.type === 'array') return `Array[${getOutputType(schema.items)}]`
  if (typeof schema.type !== 'string' || !schema.type) return 'Unknown'
  return schema.type.slice(0, 1).toLocaleUpperCase() + schema.type.slice(1)
}

const StrategyDetail: FC<Props> = ({ provider, tenantId, detail, onHide }) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation(['common', 'tools'])

  const outputSchema = useMemo(() => {
    const properties = detail.output_schema?.properties
    if (!isSchemaObject(properties)) return []
    return Object.entries(properties).map(([name, output]) => ({
      name,
      type: getOutputType(output),
      description:
        isSchemaObject(output) && typeof output.description === 'string'
          ? output.description
          : undefined,
    }))
  }, [detail.output_schema])

  const getType = (type: AgentStrategyParameterType) => {
    if (type === 'number') return t(($) => $['setBuiltInTools.number'], { ns: 'tools' })
    if (type === 'string') return t(($) => $['setBuiltInTools.string'], { ns: 'tools' })
    if (type === 'file') return t(($) => $['setBuiltInTools.file'], { ns: 'tools' })
    if (type === 'array[tools]') return 'multiple-tool-select'
    return type
  }

  return (
    <Drawer
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup
            className={cn(
              'justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-100 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border',
            )}
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              {/* header */}
              <div className="relative border-b border-divider-subtle p-4 pb-3">
                <div className="absolute top-3 right-3">
                  <IconButton
                    aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                    onClick={onHide}
                  >
                    <RiCloseLine aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
                <div
                  className="mb-2 flex cursor-pointer items-center gap-1 system-xs-semibold-uppercase text-text-accent-secondary"
                  onClick={onHide}
                >
                  <RiArrowLeftLine className="size-4" />
                  BACK
                </div>
                <div className="flex items-center gap-1">
                  <Icon
                    size="tiny"
                    className="size-6"
                    src={`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${provider.icon}`}
                  />
                  <div className="">{getValueFromI18nObject(provider.label)}</div>
                </div>
                <DrawerTitle className="mt-1 system-md-semibold text-text-primary">
                  {getValueFromI18nObject(detail.identity.label)}
                </DrawerTitle>
                <Description
                  className="mt-3"
                  text={getValueFromI18nObject(detail.description)}
                  descriptionLineRows={2}
                ></Description>
              </div>
              {/* form */}
              <div className="h-full">
                <div className="flex h-full flex-col overflow-y-auto">
                  <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">
                    {t(($) => $['setBuiltInTools.parameters'], { ns: 'tools' })}
                  </div>
                  <div className="px-4">
                    {detail.parameters && detail.parameters.length > 0 && (
                      <div className="space-y-1 py-2">
                        {detail.parameters.map((item) => (
                          <div key={item.name} className="py-1">
                            <div className="flex items-center gap-2">
                              <div className="code-sm-semibold text-text-secondary">
                                {getValueFromI18nObject(item.label)}
                              </div>
                              <div className="system-xs-regular text-text-tertiary">
                                {getType(item.type)}
                              </div>
                              {item.required && (
                                <div className="system-xs-medium text-text-warning-secondary">
                                  {t(($) => $['setBuiltInTools.required'], { ns: 'tools' })}
                                </div>
                              )}
                            </div>
                            {item.help && (
                              <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                {getValueFromI18nObject(item.help)}
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
                        <Separator className="my-2 h-[0.5px]" />
                      </div>
                      <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">
                        OUTPUT
                      </div>
                      {outputSchema.length > 0 && (
                        <div className="space-y-1 px-4 py-2">
                          {outputSchema.map((outputItem) => (
                            <div key={outputItem.name} className="py-1">
                              <div className="flex items-center gap-2">
                                <div className="code-sm-semibold text-text-secondary">
                                  {outputItem.name}
                                </div>
                                <div className="system-xs-regular text-text-tertiary">
                                  {outputItem.type}
                                </div>
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
