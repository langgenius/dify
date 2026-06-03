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
import Operator from './operator'

type RenamePayload = {
  credential_id: string
  name: string
}

type ItemProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential, renamePayload?: RenamePayload) => void
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
    <div className="flex h-10 items-center rounded-lg bg-components-panel-on-panel-item-bg pr-1 pl-3">
      {/* <div className='mr-2 h-5 w-5 shrink-0'></div> */}
      {
        renaming && (
          <div className="flex w-full items-center space-x-1">
            <Input
              className="h-6 grow rounded-md"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('placeholder.input', { ns: 'common' })}
              onClick={e => e.stopPropagation()}
            />
            <Button
              size="small"
              variant="primary"
              disabled={!canManageCredential}
              onClick={(e) => {
                e.stopPropagation()
                if (!canManageCredential)
                  return

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
          <div className="grow system-sm-medium text-text-secondary">
            {credentialItem.name}
          </div>
        )
      }
      <div className="flex shrink-0 items-center">
        <div className="mr-1 flex size-3 items-center justify-center">
          <StatusDot status="success" />
        </div>
        <div className="system-xs-semibold-uppercase text-util-colors-green-green-600">
          connected
        </div>
      </div>
      <div className="mr-2 ml-3 h-3 w-px bg-divider-regular"></div>
      <Operator
        credentialItem={credentialItem}
        onAction={onAction}
        onRename={() => setRenaming(true)}
        canUseCredential={canUseCredential}
        canManageCredential={canManageCredential}
      />
    </div>
  )
}

export default memo(Item)
