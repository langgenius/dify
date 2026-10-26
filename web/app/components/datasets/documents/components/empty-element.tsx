'use client'
import type { FC } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { FolderPlusIcon, NotionIcon, ThreeDotsIcon } from './icons'

type EmptyElementProps = {
  canAdd: boolean
  onClick: () => void
  type?: 'upload' | 'sync'
}

const EmptyElement: FC<EmptyElementProps> = ({ canAdd = false, onClick, type = 'upload' }) => {
  const { t } = useTranslation(['datasetDocuments'])
  return (
    <div className="flex h-full items-center justify-center">
      <div className="box-border h-fit w-140 rounded-2xl border-divider-subtle bg-components-panel-on-panel-item-bg px-5 py-4">
        <div className="mb-2 flex size-11 items-center justify-center rounded-lg border border-solid border-components-button-secondary-border">
          {type === 'upload' ? <FolderPlusIcon /> : <NotionIcon />}
        </div>
        <span className="font-semibold text-text-secondary">
          {t(($) => $['list.empty.title'], { ns: 'datasetDocuments' })}
          <ThreeDotsIcon className="relative -inset-s-1.5 -top-3 inline" />
        </span>
        <div className="mt-2 text-sm font-normal text-text-primary">
          {t(($) => $[`list.empty.${type}.tip`], { ns: 'datasetDocuments' })}
        </div>
        {type === 'upload' && canAdd && (
          <Button
            onClick={onClick}
            className="mt-4 w-fit border-[0.5px] border-components-button-secondary-border text-[13px]! font-medium"
            variant="secondary-accent"
          >
            <PlusIcon className="me-2 size-4 stroke-current stroke-[1.5px]" />
            {t(($) => $['list.addFile'], { ns: 'datasetDocuments' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default EmptyElement
