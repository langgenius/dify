import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'

const roleI18nKeyMap = {
  normal: 'members.normal',
  editor: 'members.editor',
  admin: 'members.admin',
  dataset_operator: 'members.datasetOperator',
} as const

export type RoleKey = keyof typeof roleI18nKeyMap

type RoleSelectorProps = {
  value: RoleKey
  onChange: (role: RoleKey) => void
}

const RoleSelector = ({ value, onChange }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const { datasetOperatorEnabled } = useProviderContext()
  const [open, setOpen] = React.useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        data-testid="role-selector-trigger"
        className={cn(
          'flex w-full cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-3 py-2 hover:bg-state-base-hover',
          open && 'bg-state-base-hover',
        )}
      >
        <div className="mr-2 grow text-sm leading-5 text-text-primary">{t('members.invitedAsRole', { ns: 'common', role: t(roleI18nKeyMap[value], { ns: 'common' }) })}</div>
        <div className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-secondary" />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[336px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg"
      >
        <div className="p-1">
          <button
            type="button"
            aria-pressed={value === 'normal'}
            className="w-full cursor-pointer rounded-lg border-none bg-transparent p-2 text-left hover:bg-state-base-hover"
            onClick={() => {
              onChange('normal')
              setOpen(false)
            }}
          >
            <div className="relative pl-5">
              <div className="text-sm leading-5 text-text-secondary">{t('members.normal', { ns: 'common' })}</div>
              <div className="text-xs leading-[18px] text-text-tertiary">{t('members.normalTip', { ns: 'common' })}</div>
              {value === 'normal' && (
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 left-0 i-custom-vender-line-general-check h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </button>
          <button
            type="button"
            aria-pressed={value === 'editor'}
            className="w-full cursor-pointer rounded-lg border-none bg-transparent p-2 text-left hover:bg-state-base-hover"
            onClick={() => {
              onChange('editor')
              setOpen(false)
            }}
          >
            <div className="relative pl-5">
              <div className="text-sm leading-5 text-text-secondary">{t('members.editor', { ns: 'common' })}</div>
              <div className="text-xs leading-[18px] text-text-tertiary">{t('members.editorTip', { ns: 'common' })}</div>
              {value === 'editor' && (
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 left-0 i-custom-vender-line-general-check h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </button>
          <button
            type="button"
            aria-pressed={value === 'admin'}
            className="w-full cursor-pointer rounded-lg border-none bg-transparent p-2 text-left hover:bg-state-base-hover"
            onClick={() => {
              onChange('admin')
              setOpen(false)
            }}
          >
            <div className="relative pl-5">
              <div className="text-sm leading-5 text-text-secondary">{t('members.admin', { ns: 'common' })}</div>
              <div className="text-xs leading-[18px] text-text-tertiary">{t('members.adminTip', { ns: 'common' })}</div>
              {value === 'admin' && (
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 left-0 i-custom-vender-line-general-check h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </button>
          {datasetOperatorEnabled && (
            <button
              type="button"
              aria-pressed={value === 'dataset_operator'}
              className="w-full cursor-pointer rounded-lg border-none bg-transparent p-2 text-left hover:bg-state-base-hover"
              onClick={() => {
                onChange('dataset_operator')
                setOpen(false)
              }}
            >
              <div className="relative pl-5">
                <div className="text-sm leading-5 text-text-secondary">{t('members.datasetOperator', { ns: 'common' })}</div>
                <div className="text-xs leading-[18px] text-text-tertiary">{t('members.datasetOperatorTip', { ns: 'common' })}</div>
                {value === 'dataset_operator' && (
                  <div
                    aria-hidden="true"
                    className="absolute top-0.5 left-0 i-custom-vender-line-general-check h-4 w-4 text-text-accent"
                  />
                )}
              </div>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default RoleSelector
