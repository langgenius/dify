import type { FC } from 'react'
import React from 'react'
import Tooltip from '@/app/components/base/tooltip'
import { RiAddCircleLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  disableAddBtn: boolean
  onAddChildField: () => void
  onEdit: () => void
  onDelete: () => void
}

const Actions: FC<ActionsProps> = ({
  disableAddBtn,
  onAddChildField,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-x-0.5'>
      <Tooltip popupContent={t('workflow.nodes.llm.jsonSchema.addChildField')}>
        <button
          type='button'
          className='flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled'
          onClick={onAddChildField}
          disabled={disableAddBtn}
        >
          <RiAddCircleLine className='h-4 w-4'/>
        </button>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.edit')}>
        <button
          type='button'
          className='flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
          onClick={onEdit}
        >
          <RiEditLine className='h-4 w-4' />
        </button>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.remove')}>
        <button
          type='button'
          className='flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive'
          onClick={onDelete}
        >
          <RiDeleteBinLine className='h-4 w-4' />
        </button>
      </Tooltip>
    </div>
  )
}

export default React.memo(Actions)
