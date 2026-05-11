'use client'
import type { Credential } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import Radio from '@/app/components/base/radio/ui'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'

type Props = {
  positionCenter?: boolean
  credential: Credential
  onChange: (credential: Credential) => void
  onHide: () => void
}

type ItemProps = {
  text: string
  value: AuthType | AuthHeaderPrefix
  isChecked: boolean
  onClick: (value: AuthType | AuthHeaderPrefix) => void
}

function SelectItem({ text, value, isChecked, onClick }: ItemProps) {
  return (
    <button
      type="button"
      className={cn(
        isChecked ? 'border-2 border-util-colors-indigo-indigo-600 bg-components-panel-on-panel-item-bg shadow-sm' : 'border border-components-card-border',
        'mb-2 flex h-9 w-37.5 cursor-pointer items-center space-x-2 rounded-xl bg-components-panel-on-panel-item-bg pl-3 text-left outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover',
      )}
      onClick={() => onClick(value)}
    >
      <Radio isChecked={isChecked} />
      <div className="system-sm-regular text-text-primary">{text}</div>
    </button>
  )
}

export default function ConfigCredential({
  positionCenter,
  credential,
  onChange,
  onHide,
}: Props) {
  const { t } = useTranslation()
  const [tempCredential, setTempCredential] = useState<Credential>(credential)

  return (
    <Drawer
      open
      modal
      disablePointerDismissal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop forceRender />
        <DrawerViewport>
          <DrawerPopup
            className={cn(
              'data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-auto data-[swipe-direction=right]:h-fit data-[swipe-direction=right]:max-h-[calc(100dvh-1rem)] data-[swipe-direction=right]:w-130 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle',
              positionCenter
                ? 'data-[swipe-direction=right]:right-[max(0.5rem,calc(50%_-_260px))]'
                : 'data-[swipe-direction=right]:right-2',
            )}
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="shrink-0 border-b border-divider-regular py-4">
                <div className="flex h-6 items-center justify-between pr-5 pl-6">
                  <DrawerTitle className="min-w-0 truncate system-xl-semibold text-text-primary">
                    {t('createTool.authMethod.title', { ns: 'tools' })}
                  </DrawerTitle>
                  <DrawerCloseButton
                    aria-label={t('operation.close', { ns: 'common' })}
                    className="h-6 w-6 rounded-md"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2">
                <div className="space-y-4">
                  <div>
                    <div className="py-2 system-sm-medium text-text-primary">{t('createTool.authMethod.type', { ns: 'tools' })}</div>
                    <div className="flex space-x-3">
                      <SelectItem
                        text={t('createTool.authMethod.types.none', { ns: 'tools' })}
                        value={AuthType.none}
                        isChecked={tempCredential.auth_type === AuthType.none}
                        onClick={value => setTempCredential({
                          auth_type: value as AuthType,
                        })}
                      />
                      <SelectItem
                        text={t('createTool.authMethod.types.api_key_header', { ns: 'tools' })}
                        value={AuthType.apiKeyHeader}
                        isChecked={tempCredential.auth_type === AuthType.apiKeyHeader}
                        onClick={value => setTempCredential({
                          auth_type: value as AuthType,
                          api_key_header: tempCredential.api_key_header || 'Authorization',
                          api_key_value: tempCredential.api_key_value || '',
                          api_key_header_prefix: tempCredential.api_key_header_prefix || AuthHeaderPrefix.custom,
                        })}
                      />
                      <SelectItem
                        text={t('createTool.authMethod.types.api_key_query', { ns: 'tools' })}
                        value={AuthType.apiKeyQuery}
                        isChecked={tempCredential.auth_type === AuthType.apiKeyQuery}
                        onClick={value => setTempCredential({
                          auth_type: value as AuthType,
                          api_key_query_param: tempCredential.api_key_query_param || 'key',
                          api_key_value: tempCredential.api_key_value || '',
                        })}
                      />
                    </div>
                  </div>
                  {tempCredential.auth_type === AuthType.apiKeyHeader && (
                    <>
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.authHeaderPrefix.title', { ns: 'tools' })}</div>
                        <div className="flex space-x-3">
                          <SelectItem
                            text={t('createTool.authHeaderPrefix.types.basic', { ns: 'tools' })}
                            value={AuthHeaderPrefix.basic}
                            isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.basic}
                            onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                          />
                          <SelectItem
                            text={t('createTool.authHeaderPrefix.types.bearer', { ns: 'tools' })}
                            value={AuthHeaderPrefix.bearer}
                            isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.bearer}
                            onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                          />
                          <SelectItem
                            text={t('createTool.authHeaderPrefix.types.custom', { ns: 'tools' })}
                            value={AuthHeaderPrefix.custom}
                            isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.custom}
                            onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center py-2 system-sm-medium text-text-primary">
                          {t('createTool.authMethod.key', { ns: 'tools' })}
                          <Infotip
                            aria-label={t('createTool.authMethod.keyTooltip', { ns: 'tools' })}
                            className="ml-0.5 h-4 w-4"
                            popupClassName="w-[261px] text-text-tertiary"
                          >
                            {t('createTool.authMethod.keyTooltip', { ns: 'tools' })}
                          </Infotip>
                        </div>
                        <Input
                          value={tempCredential.api_key_header}
                          onChange={e => setTempCredential({ ...tempCredential, api_key_header: e.target.value })}
                          placeholder={t('createTool.authMethod.types.apiKeyPlaceholder', { ns: 'tools' })!}
                        />
                      </div>
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.authMethod.value', { ns: 'tools' })}</div>
                        <Input
                          value={tempCredential.api_key_value}
                          onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                          placeholder={t('createTool.authMethod.types.apiValuePlaceholder', { ns: 'tools' })!}
                        />
                      </div>
                    </>
                  )}
                  {tempCredential.auth_type === AuthType.apiKeyQuery && (
                    <>
                      <div>
                        <div className="flex items-center py-2 system-sm-medium text-text-primary">
                          {t('createTool.authMethod.queryParam', { ns: 'tools' })}
                          <Infotip
                            aria-label={t('createTool.authMethod.queryParamTooltip', { ns: 'tools' })}
                            className="ml-0.5 h-4 w-4"
                            popupClassName="w-[261px] text-text-tertiary"
                          >
                            {t('createTool.authMethod.queryParamTooltip', { ns: 'tools' })}
                          </Infotip>
                        </div>
                        <Input
                          value={tempCredential.api_key_query_param}
                          onChange={e => setTempCredential({ ...tempCredential, api_key_query_param: e.target.value })}
                          placeholder={t('createTool.authMethod.types.queryParamPlaceholder', { ns: 'tools' })!}
                        />
                      </div>
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.authMethod.value', { ns: 'tools' })}</div>
                        <Input
                          value={tempCredential.api_key_value}
                          onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                          placeholder={t('createTool.authMethod.types.apiValuePlaceholder', { ns: 'tools' })!}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-4 flex shrink-0 justify-end space-x-2 py-4 pr-6 pl-6">
                <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onChange(tempCredential)
                    onHide()
                  }}
                >
                  {t('operation.save', { ns: 'common' })}
                </Button>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
