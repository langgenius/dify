'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import EmbeddingDetail from '../../documents/detail/embedding'

import s from './index.module.css'
import type { FullDocumentDetail, createDocumentResponse } from '@/models/datasets'

type StepThreeProps = {
  datasetId?: string
  datasetName?: string
  indexingType?: string
  creationCache?: createDocumentResponse
}

const StepThree = ({ datasetId, datasetName, indexingType, creationCache }: StepThreeProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex w-full h-full'>
      <div className={'h-full w-full overflow-y-scroll px-16'}>
        <div className='max-w-[636px]'>
          {!datasetId && (
            <>
              <div className={s.creationInfo}>
                <div className={s.title}>{t('datasetCreation.stepThree.creationTitle')}</div>
                <div className={s.content}>{t('datasetCreation.stepThree.creationContent')}</div>
                <div className={s.label}>{t('datasetCreation.stepThree.label')}</div>
                <div className={s.datasetName}>{datasetName || creationCache?.dataset?.name}</div>
              </div>
              <div className={s.dividerLine}/>
            </>
          )}
          {datasetId && (
            <div className={s.creationInfo}>
              <div className={s.title}>{t('datasetCreation.stepThree.additionTitle')}</div>
              <div className={s.content}>{`${t('datasetCreation.stepThree.additionP1')} ${datasetName || creationCache?.dataset?.name} ${t('datasetCreation.stepThree.additionP2')}`}</div>
            </div>
          )}
          {/* TODO multi doc display */}
          <EmbeddingDetail
            datasetId={datasetId || creationCache?.dataset?.id}
            documentId={creationCache?.documents[0].id}
            indexingType={indexingType || creationCache?.dataset?.indexing_technique}
            stopPosition='bottom'
            detail={creationCache?.documents[0] as FullDocumentDetail}
          />
        </div>
      </div>
      <div className={cn(s.sideTip)}>
        <div className={s.tipCard}>
          <span className={s.icon}/>
          <div className={s.title}>{t('datasetCreation.stepThree.sideTipTitle')}</div>
          <div className={s.content}>{t('datasetCreation.stepThree.sideTipContent')}</div>
        </div>
      </div>
    </div>
  )
}

export default StepThree
