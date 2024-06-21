'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Tooltip from '../../base/tooltip'
import { HelpCircle } from '../../base/icons/src/vender/line/general'
import type { Credential } from '@/app/components/tools/types'
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
const keyClassNames = 'py-2 leading-5 text-sm font-medium text-gray-900'

type ItemProps = {
  text: string
  value: AuthType | AuthHeaderPrefix
  isChecked: boolean
  onClick: (value: AuthType | AuthHeaderPrefix) => void
}

const SelectItem: FC<ItemProps> = ({ text, value, isChecked, onClick }) => {
  return (
    <div
      className={cn(isChecked ? 'border-[2px] border-indigo-600 shadow-sm bg-white' : 'border border-gray-100', 'mb-2 flex items-center h-9 pl-3 w-[150px] rounded-xl bg-gray-25 hover:bg-gray-50 cursor-pointer space-x-2')}
      onClick={() => onClick(value)}
    >
      <Radio isChecked={isChecked} />
      <div className='text-sm font-normal text-gray-900'>{text}</div>
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
      panelClassName='mt-2 !w-[520px] h-fit'
      maxWidthClassName='!max-w-[520px]'
      height={'fit-content'}
      headerClassName='!border-b-black/5'
      body={
        <div className='pt-2 px-6'>
          <div className='space-y-4'>
            <div>
              <div className={keyClassNames}>{t('tools.createTool.authMethod.type')}</div>
              <div className='flex space-x-3'>
                <SelectItem
                  text={t('tools.createTool.authMethod.types.none')}
                  value={AuthType.none}
                  isChecked={tempCredential.auth_type === AuthType.none}
                  onClick={value => setTempCredential({ ...tempCredential, auth_type: value as AuthType })}
                />
                <SelectItem
                  text={t('tools.createTool.authMethod.types.api_key')}
                  value={AuthType.apiKey}
                  isChecked={tempCredential.auth_type === AuthType.apiKey}
                  onClick={value => setTempCredential({
                    ...tempCredential,
                    auth_type: value as AuthType,
                    api_key_header: tempCredential.api_key_header || 'Authorization',
                    api_key_value: tempCredential.api_key_value || '',
                    api_key_header_prefix: tempCredential.api_key_header_prefix || AuthHeaderPrefix.custom,
                  })}
                />
              </div>
            </div>
            {tempCredential.auth_type === AuthType.apiKey && (
              <>
                <div className={keyClassNames}>{t('tools.createTool.authHeaderPrefix.title')}</div>
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
                <div>
                  <div className='flex items-center h-8 text-[13px] font-medium text-gray-900'>
                    {t('tools.createTool.authMethod.key')}
                    <Tooltip
                      selector='model-page-system-reasoning-model-tip'
                      htmlContent={
                        <div className='w-[261px] text-gray-500'>
                          {t('tools.createTool.authMethod.keyTooltip')}
                        </div>
                      }
                    >
                      <HelpCircle className='ml-0.5 w-[14px] h-[14px] text-gray-400'/>
                    </Tooltip>
                  </div>
                  <input
                    value={tempCredential.api_key_header}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_header: e.target.value })}
                    className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow'
                    placeholder={t('tools.createTool.authMethod.types.apiKeyPlaceholder')!}
                  />
                </div>
                <div>
                  <div className={keyClassNames}>{t('tools.createTool.authMethod.value')}</div>
                  <input
                    value={tempCredential.api_key_value}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                    className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow'
                    placeholder={t('tools.createTool.authMethod.types.apiValuePlaceholder')!}
                  />
                </div>
              </>)}

          </div>

          <div className='mt-4 shrink-0 flex justify-end space-x-2 py-4'>
            <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
            <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={() => {
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
