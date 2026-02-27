import type { FC } from 'react'
import { RiAddCircleLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'

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
    <div className="flex items-center gap-x-0.5">
      <Tooltip popupContent={t('nodes.llm.jsonSchema.addChildField', { ns: 'workflow' })}>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled"
          onClick={onAddChildField}
          disabled={disableAddBtn}
        >
          <RiAddCircleLine className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip popupContent={t('operation.edit', { ns: 'common' })}>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
          onClick={onEdit}
        >
          <RiEditLine className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip popupContent={t('operation.remove', { ns: 'common' })}>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
          onClick={onDelete}
        >
          <RiDeleteBinLine className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  )
}

export default React.memo(Actions)
