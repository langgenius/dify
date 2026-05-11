'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { importSchemaFromURL } from '@/service/tools'
import examples from './examples'

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
      toast.error(t('createTool.urlError', { ns: 'tools' }))
      return
    }
    setIsParsing(true)
    try {
      const { schema } = await importSchemaFromURL(importUrl)
      setImportUrl('')
      onChange(schema)
    }
    finally {
      setIsParsing(false)
      setShowImportFromUrl(false)
    }
  }

  const [showExamples, setShowExamples] = useState(false)

  return (
    <div className="flex w-[224px] justify-end gap-1">
      <DropdownMenu open={showImportFromUrl} onOpenChange={setShowImportFromUrl}>
        <DropdownMenuTrigger
          render={(
            <Button
              size="small"
              className="gap-1"
            />
          )}
        >
          <span className="i-ri-add-line size-3" aria-hidden />
          <span className="system-xs-medium text-text-secondary">{t('createTool.importFromUrl', { ns: 'tools' })}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={2}
          popupClassName="w-[300px] p-2"
        >
          <div className="relative">
            <Input
              type="text"
              className="w-full"
              placeholder={t('createTool.importFromUrlPlaceHolder', { ns: 'tools' })!}
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
            />
            <Button
              className="absolute top-1 right-1"
              size="small"
              variant="primary"
              disabled={!importUrl}
              onClick={handleImportFromUrl}
              loading={isParsing}
            >
              {isParsing ? '' : t('operation.ok', { ns: 'common' })}
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu open={showExamples} onOpenChange={setShowExamples}>
        <DropdownMenuTrigger
          render={(
            <Button
              size="small"
              className="gap-1"
            />
          )}
        >
          <span className="system-xs-medium text-text-secondary">{t('createTool.examples', { ns: 'tools' })}</span>
          <span className="i-ri-arrow-down-s-line size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={2}
          popupClassName="min-w-max"
        >
          {examples.map(item => (
            <DropdownMenuItem
              key={item.key}
              onClick={() => {
                onChange(item.content)
                setShowExamples(false)
              }}
              className="system-sm-regular whitespace-nowrap text-text-secondary"
            >
              {t(`createTool.exampleOptions.${item.key}`, { ns: 'tools' })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
export default React.memo(GetSchema)
