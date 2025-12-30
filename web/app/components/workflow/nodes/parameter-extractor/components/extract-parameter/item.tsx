'use client'
import type { FC } from 'react'
import type { Param } from '../../types'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

const i18nPrefix = 'nodes.parameterExtractor'

type Props = {
  payload: Param
  onEdit: () => void
  onDelete: () => void
}

const Item: FC<Props> = ({
  payload,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <div className="group relative rounded-lg bg-components-input-bg-normal px-2.5 py-2 hover:shadow-xs">
      <div className="flex justify-between">
        <div className="flex items-center">
          <Variable02 className="h-3.5 w-3.5 text-text-accent-secondary" />
          <div className="ml-1 text-[13px] font-medium text-text-primary">{payload.name}</div>
          <div className="ml-2 text-xs font-normal capitalize text-text-tertiary">{payload.type}</div>
        </div>
        {payload.required && (
          <div className="text-xs font-normal uppercase leading-4 text-text-tertiary">{t(`${i18nPrefix}.addExtractParameterContent.required`, { ns: 'workflow' })}</div>
        )}
      </div>
      <div className="mt-0.5 text-xs font-normal leading-[18px] text-text-tertiary">{payload.description}</div>
      <div
        className="absolute right-0 top-0 hidden h-full w-[119px] items-center justify-end space-x-1 rounded-lg bg-gradient-to-l from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent pr-1 group-hover:flex"
      >
        <div
          className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
          onClick={onEdit}
        >
          <RiEditLine className="h-4 w-4 text-text-tertiary" />
        </div>

        <div
          className="group shrink-0 cursor-pointer rounded-md p-1 hover:!bg-state-destructive-hover"
          onClick={onDelete}
        >
          <RiDeleteBinLine className="h-4 w-4 text-text-tertiary group-hover:text-text-destructive" />
        </div>
      </div>
    </div>
  )
}
export default React.memo(Item)
