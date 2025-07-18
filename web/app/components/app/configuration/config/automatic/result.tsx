'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { GeneratorType } from './types'
import PromptToast from './prompt-toast'
import Button from '@/app/components/base/button'
import useGenData from './use-gen-data'
import VersionSelector from './version-selector'

type Props = {
  storageKey: string
  onApply: () => void
  generatorType: GeneratorType
}

const Result: FC<Props> = ({
  storageKey,
  onApply,
  generatorType,
}) => {
  const { t } = useTranslation()
  const isGeneratorPrompt = generatorType === GeneratorType.prompt
  const { current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenData({
    storageKey,
  })

  return (
    <div>
      <div className='mb-3  flex items-center justify-between'>
        <div>
          <div className='shrink-0 text-base font-semibold leading-[160%] text-text-secondary'>{t('appDebug.generate.resTitle')}</div>
          <VersionSelector
            versionLen={versions.length}
            value={currentVersionIndex}
            onChange={setCurrentVersionIndex}
          />
        </div>
        <div className='flex space-x-2'>
          <Button variant='primary' onClick={onApply}>
            {t('appDebug.generate.apply')}
          </Button>
        </div>
      </div>
      {
        isGeneratorPrompt && (
          <PromptToast className='mt-4' />
        )
      }
      <div className='mt-3'>{current?.modified}</div>
    </div>
  )
}
export default React.memo(Result)
