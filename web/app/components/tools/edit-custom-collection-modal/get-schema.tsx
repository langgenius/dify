'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import Toast from '../../base/toast'
import examples from './examples'
import Button from '@/app/components/base/button'
import { importSchemaFromURL } from '@/service/tools'

type Props = {
  onChange: (value: string) => void
}

const GetSchema: FC<Props> = ({
  onChange,
}) => {
  const { t } = useTranslation()
  const [showImportFromUrl, setShowImportFromUrl] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const handleImportFromUrl = async () => {
    if (!importUrl.startsWith('http://') && !importUrl.startsWith('https://')) {
      Toast.notify({
        type: 'error',
        message: t('tools.createTool.urlError'),
      })
      return
    }
    setIsParsing(true)
    try {
      const { schema } = await importSchemaFromURL(importUrl) as any
      setImportUrl('')
      onChange(schema)
    }
    finally {
      setIsParsing(false)
      setShowImportFromUrl(false)
    }
  }

  const importURLRef = React.useRef(null)
  useClickAway(() => {
    setShowImportFromUrl(false)
  }, importURLRef)

  const [showExamples, setShowExamples] = useState(false)
  const showExamplesRef = React.useRef(null)
  useClickAway(() => {
    setShowExamples(false)
  }, showExamplesRef)

  return (
    <div className='flex space-x-1 justify-end relative w-[224px]'>
      <div ref={importURLRef}>
        <Button
          size='small'
          className='space-x-1 '
          onClick={() => { setShowImportFromUrl(!showImportFromUrl) }}
        >
          <RiAddLine className='w-3 h-3' />
          <div className='text-xs font-medium text-gray-700'>{t('tools.createTool.importFromUrl')}</div>
        </Button>
        {showImportFromUrl && (
          <div className=' absolute left-[-35px] top-[26px] p-2 rounded-lg border border-gray-200 bg-white shadow-lg'>
            <div className='relative'>
              <input
                type='text'
                className='w-[244px] h-8 pl-1.5 pr-[44px] overflow-x-auto border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:border-components-input-border-active'
                placeholder={t('tools.createTool.importFromUrlPlaceHolder')!}
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
              />
              <Button
                className='absolute top-1 right-1'
                size='small'
                variant='primary'
                disabled={!importUrl}
                onClick={handleImportFromUrl}
                loading={isParsing}
              >
                {isParsing ? '' : t('common.operation.ok')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className='relative -mt-0.5' ref={showExamplesRef}>
        <Button
          size='small'
          className='space-x-1'
          onClick={() => { setShowExamples(!showExamples) }}
        >
          <div className='text-xs font-medium text-gray-700'>{t('tools.createTool.examples')}</div>
          <RiArrowDownSLine className='w-3 h-3' />
        </Button>
        {showExamples && (
          <div className='absolute top-7 right-0 p-1 rounded-lg bg-white shadow-sm'>
            {examples.map(item => (
              <div
                key={item.key}
                onClick={() => {
                  onChange(item.content)
                  setShowExamples(false)
                }}
                className='px-3 py-1.5 rounded-lg hover:bg-gray-50 leading-5 text-sm font-normal text-gray-700 cursor-pointer whitespace-nowrap'
              >
                {t(`tools.createTool.exampleOptions.${item.key}`)}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
export default React.memo(GetSchema)
