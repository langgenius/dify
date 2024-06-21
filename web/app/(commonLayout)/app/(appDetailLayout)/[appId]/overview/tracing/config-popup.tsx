'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import TracingIcon from './tracing-icon'
import ProviderPanel from './provider-panel'
import { TracingProvider } from './type'
import ProviderConfigModal from './provider-config-modal'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'

const I18N_PREFIX = 'app.tracing'

export type PopupProps = {
  enabled: boolean
  onStatusChange?: (enabled: boolean) => void
}

const ConfigPopup: FC<PopupProps> = ({
  enabled,
  onStatusChange,
}) => {
  const { t } = useTranslation()

  const [currentProvider, setCurrentProvider] = useState<TracingProvider | null>(TracingProvider.langfuse)
  const [isShowConfigModal, {
    setTrue: showConfigModal,
    setFalse: hideConfigModal,
  }] = useBoolean(true)
  const handleOnConfig = useCallback((provider: TracingProvider) => {
    return () => {
      setCurrentProvider(provider)
      showConfigModal()
    }
  }, [showConfigModal])

  const handleOnChoose = useCallback((provider: TracingProvider) => {
    return () => {
      console.log(provider)
    }
  }, [])

  return (
    <div className='w-[420px] p-4 rounded-2xl bg-white border-[0.5px] border-black/5 shadow-lg'>
      <div className='flex justify-between items-center'>
        <div className='flex items-center'>
          <TracingIcon size='md' className='mr-2' />
          <div className='leading-[120%] text-[18px] font-semibold text-gray-900'>{t(`${I18N_PREFIX}.tracing`)}</div>
        </div>
        <div className='flex items-center'>
          <Indicator color={enabled ? 'green' : 'gray'} />
          <div className='ml-1.5 text-xs font-semibold text-gray-500 uppercase'>
            {t(`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`)}
          </div>
          <Switch
            className='ml-3'
            defaultValue={enabled}
            onChange={onStatusChange}
            size='l'
          />
        </div>
      </div>

      <div className='mt-2 leading-4 text-xs font-normal text-gray-500'>
        {t(`${I18N_PREFIX}.tracingDescription`)}
      </div>
      <div className='mt-3 h-px bg-gray-100'></div>
      <div className='mt-3'>
        <div className='leading-4 text-xs font-medium text-gray-500 uppercase'>{t(`${I18N_PREFIX}.configProviderTitle`)}</div>
        <div className='mt-2 space-y-2'>
          <ProviderPanel
            type={TracingProvider.langSmith}
            onConfig={handleOnConfig(TracingProvider.langSmith)}
            onChoose={handleOnChoose(TracingProvider.langSmith)}
          />
          <ProviderPanel type={TracingProvider.langfuse}
            onConfig={handleOnConfig(TracingProvider.langfuse)}
            onChoose={handleOnChoose(TracingProvider.langfuse)}
          />
        </div>
      </div>
      {isShowConfigModal && (
        <ProviderConfigModal
          type={currentProvider!}
          onCancel={hideConfigModal}
          onSaved={hideConfigModal}
        />
      )}
    </div>
  )
}
export default React.memo(ConfigPopup)
