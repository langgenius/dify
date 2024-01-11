'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Credential } from '@/app/components/tools/types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Radio from '@/app/components/base/radio/ui'
import { AuthType } from '@/app/components/tools/types'

type Props = {
  credential: Credential
  onChange: (credential: Credential) => void
  onHide: () => void
}
const keyClassNames = 'py-2 leading-5 text-sm font-medium text-gray-900'

type ItemProps = {
  text: string
  value: AuthType
  isChecked: boolean
  onClick: (value: AuthType) => void
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
  credential,
  onChange,
  onHide,
}) => {
  const { t } = useTranslation()
  const [tempCredential, setTempCredential] = React.useState<Credential>(credential)
  return (
    <Drawer
      isShow
      onHide={onHide}
      title={t('tools.createTool.authMethod.title')!}
      panelClassName='mt-2 !w-[520px]'
      maxWidthClassName='!max-w-[520px]'
      height='calc(100vh - 16px)'
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
                  onClick={value => setTempCredential({ ...tempCredential, auth_type: value })}
                />
                <SelectItem
                  text={t('tools.createTool.authMethod.types.api_key')}
                  value={AuthType.apiKey}
                  isChecked={tempCredential.auth_type === AuthType.apiKey}
                  onClick={value => setTempCredential({ ...tempCredential, auth_type: value })}
                />
              </div>
            </div>
            {tempCredential.auth_type === AuthType.apiKey && (
              <>
                <div>
                  <div className={keyClassNames}>{t('tools.createTool.authMethod.key')}</div>
                  <input
                    value={tempCredential.api_key_header}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_header: e.target.value })}
                    className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' />
                </div>

                <div>
                  <div className={keyClassNames}>{t('tools.createTool.authMethod.value')}</div>
                  <input
                    value={tempCredential.api_key_value}
                    onChange={e => setTempCredential({ ...tempCredential, api_key_value: e.target.value })}
                    className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' />
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
