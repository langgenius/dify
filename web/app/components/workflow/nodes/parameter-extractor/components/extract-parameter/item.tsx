'use client'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { ParameterDialog } from './update'

const i18nPrefix = 'nodes.parameterExtractor'

type Props = Readonly<{
  payload: Param
  readonly: boolean
  onSave: (payload: Param, moreInfo?: MoreInfo) => void
  onDelete: () => void
}>

export function ParameterItem({ payload, readonly, onSave, onDelete }: Props) {
  const { t } = useTranslation(['common', 'workflowModels'])

  return (
    <div className="group relative rounded-lg bg-components-input-bg-normal px-2.5 py-2 hover:shadow-xs">
      <div className="flex justify-between">
        <div className="flex items-center">
          <span
            aria-hidden
            className="i-custom-vender-solid-development-variable-02 size-3.5 text-text-accent-secondary"
          />
          <div className="ml-1 text-[13px] font-medium text-text-primary">{payload.name}</div>
          <div className="ml-2 text-xs font-normal text-text-tertiary capitalize">
            {payload.type}
          </div>
        </div>
        {payload.required && (
          <div className="text-xs/4 font-normal text-text-tertiary uppercase">
            {t(($) => $[`${i18nPrefix}.addExtractParameterContent.required`], {
              ns: 'workflowModels',
            })}
          </div>
        )}
      </div>
      <div className="mt-0.5 text-xs leading-4.5 font-normal text-text-tertiary">
        {payload.description}
      </div>
      {!readonly && (
        <div className="pointer-events-none absolute top-0 right-0 flex h-full w-29.75 items-center justify-end space-x-1 rounded-lg bg-linear-to-l from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent pr-1 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <ParameterDialog type="edit" payload={payload} onSave={onSave} />
          <IconButton
            aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${payload.name}`}
            tone="destructive"
            onClick={onDelete}
          >
            <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
          </IconButton>
        </div>
      )}
    </div>
  )
}
