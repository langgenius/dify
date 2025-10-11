'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import type { Credential } from '@/app/components/tools/types'
import Input from '@/app/components/base/input'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
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

const SelectItem: FC<ItemProps> = ({ text, value, isChecked, onClick }) => {
  return (
    <div
      className={cn(isChecked ? 'border-[2px] border-util-colors-indigo-indigo-600 bg-components-panel-on-panel-item-bg shadow-sm' : 'border border-components-card-border', 'mb-2 flex h-9 w-[150px] cursor-pointer items-center space-x-2 rounded-xl bg-components-panel-on-panel-item-bg pl-3 hover:bg-components-panel-on-panel-item-bg-hover')}
      onClick={() => onClick(value)}
    >
      <Radio isChecked={isChecked} />
      <div className='system-sm-regular text-text-primary'>{text}</div>
    </div>
  )
}

const ConfigCredential: FC<Props> = ({
  positionCenter,
  credential,
  onChange,
  onHide,
}) => {
  const { t } = useTranslation()
  const [tempCredential, setTempCredential] = React.useState<Credential>(credential)

  return (
    <Drawer
      isShow
      positionCenter={positionCenter}
      onHide={onHide}
      title={t('tools.createTool.authMethod.title')!}
      dialogClassName='z-[60]'
      dialogBackdropClassName='z-[70]'
      panelClassName='mt-2 !w-[520px] h-fit z-[80]'
      maxWidthClassName='!max-w-[520px]'
      height={'fit-content'}
      headerClassName='!border-b-divider-regular'
      body={
        <div className='px-6 pt-2'>
          <div className='space-y-4'>
            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.authMethod.type')}</div>
              <div className='flex space-x-3'>
                <SelectItem
                  text={t('tools.createTool.authMethod.types.none')}
                  value={AuthType.none}
                  isChecked={tempCredential.auth_type === AuthType.none}
                  onClick={value => setTempCredential({
                    auth_type: value as AuthType,
                  })}
                />
                <SelectItem
                  text={t('tools.createTool.authMethod.types.api_key_header')}
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
                  text={t('tools.createTool.authMethod.types.api_key_query')}
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
                  <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.authHeaderPrefix.title')}</div>
                  <div className='flex space-x-3'>
                    <SelectItem
                      text={t('tools.createTool.authHeaderPrefix.types.basic')}
                      value={AuthHeaderPrefix.basic}
                      isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.basic}
                      onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                    />
                    <SelectItem
                      text={t('tools.createTool.authHeaderPrefix.types.bearer')}
                      value={AuthHeaderPrefix.bearer}
                      isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.bearer}
                      onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                    />
                    <SelectItem
                      text={t('tools.createTool.authHeaderPrefix.types.custom')}
                      value={AuthHeaderPrefix.custom}
                      isChecked={tempCredential.api_key_header_prefix === AuthHeaderPrefix.custom}
                      onClick={value => setTempCredential({ ...tempCredential, api_key_header_prefix: value as AuthHeaderPrefix })}
                    />
                  </div>
                </div>
                <div>
                  <div className='system-sm-medium flex items-center py-2 text-text-primary'>
                    {t('tools.createTool.authMethod.key')}
                    <Tooltip
                      popupContent={
                        <div className='w-[261px] text-text-tertiary'>
                          {t('tools.createTool.authMethod.keyTooltip')}
                        </div>
                      }
                      triggerClassName='ml-0.5 w-4 h-4'
                    />
                  </div>
                  <Input
                    value={tempCredential.api_key_header}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_header: e.target.value })}
                    placeholder={t('tools.createTool.authMethod.types.apiKeyPlaceholder')!}
                  />
                </div>
                <div>
                  <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.authMethod.value')}</div>
                  <Input
                    value={tempCredential.api_key_value}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                    placeholder={t('tools.createTool.authMethod.types.apiValuePlaceholder')!}
                  />
                </div>
              </>)}
            {tempCredential.auth_type === AuthType.apiKeyQuery && (
              <>
                <div>
                  <div className='system-sm-medium flex items-center py-2 text-text-primary'>
                    {t('tools.createTool.authMethod.queryParam')}
                    <Tooltip
                      popupContent={
                        <div className='w-[261px] text-text-tertiary'>
                          {t('tools.createTool.authMethod.queryParamTooltip')}
                        </div>
                      }
                      triggerClassName='ml-0.5 w-4 h-4'
                    />
                  </div>
                  <Input
                    value={tempCredential.api_key_query_param}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_query_param: e.target.value })}
                    placeholder={t('tools.createTool.authMethod.types.queryParamPlaceholder')!}
                  />
                </div>
                <div>
                  <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.authMethod.value')}</div>
                  <Input
                    value={tempCredential.api_key_value}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                    placeholder={t('tools.createTool.authMethod.types.apiValuePlaceholder')!}
                  />
                </div>
              </>)}

          </div>

          <div className='mt-4 flex shrink-0 justify-end space-x-2 py-4'>
            <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
            <Button variant='primary' onClick={() => {
              onChange(tempCredential)
              onHide()
            }}>{t('common.operation.save')}</Button>
          </div>
        </div>
      }
    />
  )
}
export default React.memo(ConfigCredential)
