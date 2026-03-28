import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'

const roleI18nKeyMap = {
  normal: 'members.normal',
  editor: 'members.editor',
  admin: 'members.admin',
  dataset_operator: 'members.datasetOperator',
} as const

export type RoleKey = keyof typeof roleI18nKeyMap

export type RoleSelectorProps = {
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
          <div
            data-testid="role-option-normal"
            className="cursor-pointer rounded-lg p-2 hover:bg-state-base-hover"
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
                  data-testid="role-option-check"
                  className="i-custom-vender-line-general-check absolute left-0 top-0.5 h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </div>
          <div
            data-testid="role-option-editor"
            className="cursor-pointer rounded-lg p-2 hover:bg-state-base-hover"
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
                  data-testid="role-option-check"
                  className="i-custom-vender-line-general-check absolute left-0 top-0.5 h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </div>
          <div
            data-testid="role-option-admin"
            className="cursor-pointer rounded-lg p-2 hover:bg-state-base-hover"
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
                  data-testid="role-option-check"
                  className="i-custom-vender-line-general-check absolute left-0 top-0.5 h-4 w-4 text-text-accent"
                />
              )}
            </div>
          </div>
          {datasetOperatorEnabled && (
            <div
              data-testid="role-option-dataset_operator"
              className="cursor-pointer rounded-lg p-2 hover:bg-state-base-hover"
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
                    data-testid="role-option-check"
                    className="i-custom-vender-line-general-check absolute left-0 top-0.5 h-4 w-4 text-text-accent"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default RoleSelector
