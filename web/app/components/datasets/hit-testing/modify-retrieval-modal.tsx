'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Toast from '../../base/toast'
import { ModelTypeEnum } from '../../header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import Button from '@/app/components/base/button'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useDocLink } from '@/context/i18n'

type Props = {
  indexMethod: string
  value: RetrievalConfig
  isShow: boolean
  onHide: () => void
  onSave: (value: RetrievalConfig) => void
}

const ModifyRetrievalModal: FC<Props> = ({
  indexMethod,
  value,
  isShow,
  onHide,
  onSave,
}) => {
  const ref = useRef(null)
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [retrievalConfig, setRetrievalConfig] = useState(value)

  // useClickAway(() => {
  //   if (ref)
  //     onHide()
  // }, ref)

  const {
    modelList: rerankModelList,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const handleSave = () => {
    if (
      !isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      Toast.notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
      return
    }
    onSave(retrievalConfig)
  }

  if (!isShow)
    return null

  return (
    <div
      className='flex w-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'
      style={{
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className='h-15 flex shrink-0 justify-between px-3 pb-1 pt-3.5'>
        <div className='text-base font-semibold text-text-primary'>
          <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
          <div className='text-xs font-normal leading-[18px] text-text-tertiary'>
            <a
              target='_blank'
              rel='noopener noreferrer'
              href={docLink('/guides/knowledge-base/retrieval-test-and-citation#modify-text-retrieval-setting', {
                'zh-Hans': '/guides/knowledge-base/retrieval-test-and-citation#修改文本检索方式',
                'ja-JP': '/guides/knowledge-base/retrieval-test-and-citation',
              })}
              className='text-text-accent'
            >
              {t('datasetSettings.form.retrievalSetting.learnMore')}
            </a>
            {t('datasetSettings.form.retrievalSetting.description')}
          </div>
        </div>
        <div className='flex'>
          <div
            onClick={onHide}
            className='flex h-8 w-8 cursor-pointer items-center justify-center'
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>

      <div className='px-4 py-2'>
        <div className='mb-1 text-[13px] font-semibold leading-6 text-text-secondary'>
          {t('datasetSettings.form.retrievalSetting.method')}
        </div>
        {indexMethod === 'high_quality'
          ? (
            <RetrievalMethodConfig
              value={retrievalConfig}
              onChange={setRetrievalConfig}
            />
          )
          : (
            <EconomicalRetrievalMethodConfig
              value={retrievalConfig}
              onChange={setRetrievalConfig}
            />
          )}
      </div>
      <div className='flex justify-end p-4 pt-2'>
        <Button className='mr-2 shrink-0' onClick={onHide}>{t('common.operation.cancel')}</Button>
        <Button variant='primary' className='shrink-0' onClick={handleSave} >{t('common.operation.save')}</Button>
      </div>
    </div>
  )
}
export default React.memo(ModifyRetrievalModal)
