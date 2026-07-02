import type {
  DataSourceCredential,
} from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionLevel } from '@/models/permission'
import Operator from './operator'

type ItemProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential, renamePayload?: { credential_id: string, name: string }) => void
  canUseCredential?: boolean
  canManageCredential?: boolean
}
const Item = ({
  credentialItem,
  onAction,
  canUseCredential = false,
  canManageCredential = false,
}: ItemProps) => {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(credentialItem.name)

  return (
    <div className="flex h-10 items-center gap-3 overflow-hidden rounded-lg bg-components-panel-on-panel-item-bg py-1 pr-1 pl-3 shadow-xs">
      {
        renaming && (
          <div className="flex w-full items-center space-x-1">
            <Input
              className="h-6 min-w-0 grow"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('placeholder.input', { ns: 'common' })}
              onClick={e => e.stopPropagation()}
            />
            <Button
              size="small"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation()
                onAction?.(
                  'rename',
                  credentialItem,
                  {
                    credential_id: credentialItem.id,
                    name: renameValue,
                  },
                )
                setRenaming(false)
              }}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(false)
              }}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        )
      }
      {
        !renaming && (
          <>
            <div className="min-w-0 grow truncate system-sm-medium text-text-secondary">
              {credentialItem.name}
            </div>
            {
              credentialItem.is_default && (
                <div className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-tertiary">
                  {t('auth.default', { ns: 'plugin' })}
                </div>
              )
            }
            {
              // all_team_members is the default scope, so only restricted scopes get a badge.
              credentialItem.visibility === PermissionLevel.onlyMe && (
                <div className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium text-text-tertiary">
                  {t('form.permissionsOnlyMe', { ns: 'datasetSettings' })}
                </div>
              )
            }
            {
              credentialItem.visibility === PermissionLevel.partialMembers && (
                <div className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium text-text-tertiary">
                  {t('form.permissionsInvitedMembers', { ns: 'datasetSettings' })}
                </div>
              )
            }
          </>
        )
      }
      {
        !renaming && (
          <>
            <div className="ml-auto flex shrink-0 items-center">
              <div className="mr-1 flex h-3 w-3 items-center justify-center">
                <StatusDot status="success" />
              </div>
              <div className="system-xs-semibold-uppercase text-util-colors-green-green-600">
                {t('dataSource.notion.connected', { ns: 'common' })}
              </div>
            </div>
            <div className="mr-1 ml-2 h-3 w-px bg-divider-regular"></div>
            <Operator
              credentialItem={credentialItem}
              onAction={onAction}
              onRename={() => setRenaming(true)}
              canUseCredential={canUseCredential}
              canManageCredential={canManageCredential}
            />
          </>
        )
      }
    </div>
  )
}

export default memo(Item)
