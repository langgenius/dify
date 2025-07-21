import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'
import Operator from './operator'
import type {
  DataSourceCredential,
} from './types'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'

type ItemProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential, renamePayload?: Record<string, any>) => void
}
const Item = ({
  credentialItem,
  onAction,
}: ItemProps) => {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(credentialItem.name)

  return (
    <div className='flex h-10 items-center rounded-lg bg-components-panel-on-panel-item-bg pl-3 pr-1'>
      {/* <div className='mr-2 h-5 w-5 shrink-0'></div> */}
      {
        renaming && (
          <div className='flex w-full items-center space-x-1'>
            <Input
              wrapperClassName='grow rounded-[6px]'
              className='h-6'
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('common.placeholder.input')}
              onClick={e => e.stopPropagation()}
            />
            <Button
              size='small'
              variant='primary'
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
              {t('common.operation.save')}
            </Button>
            <Button
              size='small'
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(false)
              }}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
        )
      }
      {
        !renaming && (
          <div className='system-sm-medium grow text-text-secondary'>
            {credentialItem.name}
          </div>
        )
      }
      <div className='flex shrink-0 items-center'>
        <div className='mr-1 flex h-3 w-3 items-center justify-center'>
          <Indicator color='green' />
        </div>
        <div className='system-xs-semibold-uppercase text-util-colors-green-green-600'>
          connected
        </div>
      </div>
      <div className='ml-3 mr-2 h-3 w-[1px] bg-divider-regular'></div>
      <Operator
        credentialItem={credentialItem}
        onAction={onAction}
        onRename={() => setRenaming(true)}
      />
    </div>
  )
}

export default memo(Item)
