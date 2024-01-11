'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings01 } from '../../base/icons/src/vender/line/general'
import ConfigCredentials from './config-credentials'
import type { Credential } from '@/app/components/tools/types'
import Button from '@/app/components/base/button'

import Drawer from '@/app/components/base/drawer-plus'
type Props = {
  toolName: string
  credential: Credential
  onHide: () => void
}

const keyClassNames = 'py-2 leading-5 text-sm font-medium text-gray-900'

const TestApi: FC<Props> = ({
  toolName,
  credential,
  onHide,
}) => {
  const { t } = useTranslation()
  const [credentialsModalShow, setCredentialsModalShow] = useState(false)
  const [tempCredential, setTempCredential] = React.useState<Credential>(credential)
  const [result, setResult] = useState<string>('')

  const handleTest = () => {
    setResult('testssssss')
  }
  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={`${t('tools.test.title')}  ${toolName}`}
        panelClassName='mt-2 !w-[600px]'
        maxWidthClassName='!max-w-[600px]'
        height='calc(100vh - 16px)'
        headerClassName='!border-b-black/5'
        body={
          <div className='pt-2 px-6 overflow-y-auto'>
            <div className='space-y-4'>
              <div>
                <div className={keyClassNames}>{t('tools.createTool.authMethod.title')}</div>
                <div className='flex items-center h-9 justify-between px-2.5 bg-gray-100 rounded-lg cursor-pointer' onClick={() => setCredentialsModalShow(true)}>
                  <div className='text-sm font-normal text-gray-900'>{t(`tools.createTool.authMethod.types.${tempCredential.auth_type}`)}</div>
                  <Settings01 className='w-4 h-4 text-gray-700 opacity-60' />
                </div>
              </div>

              <div>
                <div className={keyClassNames}>{t('tools.test.parametersValue')}</div>
                <div className='rounded-lg border border-gray-200'>
                  <table className='w-full leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className='border-b border-gray-200'>
                        <th className="p-2 pl-3 font-medium">{t('tools.test.parameters')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.test.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b last:border-0 border-gray-200'>
                        <td className="py-2 pl-3 pr-2.5">
                          adfdfd
                        </td>
                        <td className="">
                          <input type='text' className='px-3 h-[34px] w-full outline-none focus:bg-gray-100' ></input>
                        </td>
                      </tr>
                      <tr className='border-b last:border-0 border-gray-200'>
                        <td className="py-2 pl-3 pr-2.5">
                          adfdfd
                        </td>
                        <td className="">
                          <input type='text' className='px-3 h-[34px] w-full outline-none focus:bg-gray-100' ></input>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
            <Button type='primary' className=' mt-4 w-full h-10 !text-[13px] leading-[18px] font-medium' onClick={handleTest}>{t('tools.test.title')}</Button>
            <div className='mt-6'>
              <div className='flex items-center space-x-3'>
                <div className='leading-[18px] text-xs font-semibold text-gray-500'>{t('tools.test.testResult')}</div>
                <div className='grow w-0 h-px bg-[rgb(243, 244, 246)]'></div>
              </div>
              <div className='mt-2 px-3 py-2 h-[200px] overflow-y-auto overflow-x-hidden rounded-lg bg-gray-100 leading-4 text-xs font-normal text-gray-400'>
                {result || t('tools.test.testResultPlaceholder')}
              </div>
            </div>
          </div>
        }
      />
      {credentialsModalShow && (
        <ConfigCredentials
          credential={tempCredential}
          onChange={setTempCredential}
          onHide={() => setCredentialsModalShow(false)}
        />)
      }
    </>
  )
}
export default React.memo(TestApi)
