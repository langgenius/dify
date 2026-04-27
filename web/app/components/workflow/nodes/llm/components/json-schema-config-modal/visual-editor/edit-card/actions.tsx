import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
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
  const addChildFieldLabel = t('nodes.llm.jsonSchema.addChildField', { ns: 'workflow' })
  const editLabel = t('operation.edit', { ns: 'common' })
  const removeLabel = t('operation.remove', { ns: 'common' })

  return (
    <div className="flex items-center gap-x-0.5">
      <Tooltip>
        <TooltipTrigger
          render={(
            <span className="inline-flex">
              <button
                type="button"
                aria-label={addChildFieldLabel}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled"
                onClick={onAddChildField}
                disabled={disableAddBtn}
              >
                <span aria-hidden className="i-ri-add-circle-line h-4 w-4" />
              </button>
            </span>
          )}
        />
        <TooltipContent>{addChildFieldLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button
              type="button"
              aria-label={editLabel}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
              onClick={onEdit}
            >
              <span aria-hidden className="i-ri-edit-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>{editLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button
              type="button"
              aria-label={removeLabel}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
              onClick={onDelete}
            >
              <span aria-hidden className="i-ri-delete-bin-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default React.memo(Actions)
