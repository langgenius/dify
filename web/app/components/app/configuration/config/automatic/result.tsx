'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { GeneratorType } from './types'
import PromptToast from './prompt-toast'
import Button from '@/app/components/base/button'

type Props = {
  storageKey: string
  onApply: (result: string) => void
  generatorType: GeneratorType
}

const Result: FC<Props> = ({
  storageKey,
  onApply,
  generatorType,
}) => {
  const { t } = useTranslation()
  const isGeneratorPrompt = generatorType === GeneratorType.prompt
  const handleApply = useCallback(() => {
    onApply('xxx')
  }, [onApply])

  // todo current version and version list
  const current = 'xxxx'
  return (
    <div>
      <div className='mb-3  flex items-center justify-between'>
        <div className='shrink-0 text-base font-semibold leading-[160%] text-text-secondary'>{t('appDebug.generate.resTitle')}</div>
        <div className='flex space-x-2'>
          <Button variant='primary' onClick={handleApply}>
            {t('appDebug.generate.apply')}
          </Button>
        </div>
      </div>
      {
        isGeneratorPrompt && (
          <PromptToast className='mt-4' />
        )
      }
      <div className='mt-3'>{current}</div>
    </div>
  )
}
export default React.memo(Result)
