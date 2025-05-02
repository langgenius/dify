'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { RiSettings2Line } from '@remixicon/react'
import ConfigCredentials from './config-credentials'
import { AuthType, type Credential, type CustomCollectionBackend, type CustomParamSchema } from '@/app/components/tools/types'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Drawer from '@/app/components/base/drawer-plus'
import I18n from '@/context/i18n'
import { testAPIAvailable } from '@/service/tools'
import { getLanguage } from '@/i18n/language'

type Props = {
  positionCenter?: boolean
  customCollection: CustomCollectionBackend
  tool: CustomParamSchema
  onHide: () => void
}

const TestApi: FC<Props> = ({
  positionCenter,
  customCollection,
  tool,
  onHide,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const [credentialsModalShow, setCredentialsModalShow] = useState(false)
  const [tempCredential, setTempCredential] = React.useState<Credential>(customCollection.credentials)
  const [result, setResult] = useState<string>('')
  const { operation_id: toolName, parameters } = tool
  const [parametersValue, setParametersValue] = useState<Record<string, string>>({})
  const handleTest = async () => {
    // clone test schema
    const credentials = JSON.parse(JSON.stringify(tempCredential)) as Credential
    if (credentials.auth_type === AuthType.none) {
      delete credentials.api_key_header_prefix
      delete credentials.api_key_header
      delete credentials.api_key_value
    }
    const data = {
      provider_name: customCollection.provider,
      tool_name: toolName,
      credentials,
      schema_type: customCollection.schema_type,
      schema: customCollection.schema,
      parameters: parametersValue,
    }
    const res = await testAPIAvailable(data) as any
    setResult(res.error || res.result)
  }

  return (
    <>
      <Drawer
        isShow
        positionCenter={positionCenter}
        onHide={onHide}
        title={`${t('tools.test.title')}  ${toolName}`}
        panelClassName='mt-2 !w-[600px]'
        maxWidthClassName='!max-w-[600px]'
        height='calc(100vh - 16px)'
        headerClassName='!border-b-divider-regular'
        body={
          <div className='pt-2 px-6 overflow-y-auto'>
            <div className='space-y-4'>
              <div>
                <div className='py-2 system-sm-medium text-text-primary'>{t('tools.createTool.authMethod.title')}</div>
                <div className='flex items-center h-9 justify-between px-2.5 bg-components-input-bg-normal rounded-lg cursor-pointer' onClick={() => setCredentialsModalShow(true)}>
                  <div className='system-xs-regular text-text-primary'>{t(`tools.createTool.authMethod.types.${tempCredential.auth_type}`)}</div>
                  <RiSettings2Line className='w-4 h-4 text-text-secondary' />
                </div>
              </div>

              <div>
                <div className='py-2 system-sm-medium text-text-primary'>{t('tools.test.parametersValue')}</div>
                <div className='rounded-lg border border-divider-regular'>
                  <table className='w-full system-xs-regular text-text-secondary font-normal'>
                    <thead className='text-text-tertiary uppercase'>
                      <tr className='border-b border-divider-regular'>
                        <th className="p-2 pl-3 font-medium">{t('tools.test.parameters')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.test.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((item, index) => (
                        <tr key={index} className='border-b last:border-0 border-divider-regular'>
                          <td className="py-2 pl-3 pr-2.5">
                            {item.label[language]}
                          </td>
                          <td className="">
                            <Input
                              value={parametersValue[item.name] || ''}
                              onChange={e => setParametersValue({ ...parametersValue, [item.name]: e.target.value })}
                              type='text'
                              className='!bg-transparent !border-transparent !hover:border-transparent !hover:bg-transparent !focus:border-transparent !focus:bg-transparent' />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
            <Button variant='primary' className=' mt-4 w-full h-10' onClick={handleTest}>{t('tools.test.title')}</Button>
            <div className='mt-6'>
              <div className='flex items-center space-x-3'>
                <div className='system-xs-semibold text-text-tertiary'>{t('tools.test.testResult')}</div>
                <div className='grow w-0 h-px bg-[rgb(243, 244, 246)]'></div>
              </div>
              <div className='mt-2 px-3 py-2 h-[200px] overflow-y-auto overflow-x-hidden rounded-lg bg-components-input-bg-normal system-xs-regular text-text-secondary'>
                {result || <span className='text-text-quaternary'>{t('tools.test.testResultPlaceholder')}</span>}
              </div>
            </div>
          </div>
        }
      />
      {credentialsModalShow && (
        <ConfigCredentials
          positionCenter={positionCenter}
          credential={tempCredential}
          onChange={setTempCredential}
          onHide={() => setCredentialsModalShow(false)}
        />)
      }
    </>
  )
}
export default React.memo(TestApi)
