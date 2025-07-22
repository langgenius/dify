import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
  RiHome9Line,
  RiStickyNoteAddLine,
} from '@remixicon/react'
import Dropdown from '@/app/components/base/dropdown'
import type { Item } from '@/app/components/base/dropdown'
import type {
  DataSourceCredential,
} from './types'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

type OperatorProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential) => void
  onRename?: () => void
}
const Operator = ({
  credentialItem,
  onAction,
  onRename,
}: OperatorProps) => {
  const { t } = useTranslation()
  const {
    type,
  } = credentialItem
  const items = useMemo(() => {
    const commonItems = [
      {
        value: 'setDefault',
        text: (
          <div className='flex items-center'>
            <RiHome9Line className='mr-2 h-4 w-4 text-text-tertiary' />
            <div className='system-sm-semibold text-text-secondary'>{t('plugin.auth.setDefault')}</div>
          </div>
        ),
      },
      ...(
        type === CredentialTypeEnum.OAUTH2
          ? [
            {
              value: 'rename',
              text: (
                <div className='flex items-center'>
                  <RiEditLine className='mr-2 h-4 w-4 text-text-tertiary' />
                  <div className='system-sm-semibold text-text-secondary'>{t('common.operation.rename')}</div>
                </div>
              ),
            },
          ]
          : []
      ),
      ...(
        type === CredentialTypeEnum.API_KEY
          ? [
            {
              value: 'edit',
              text: (
                <div className='flex items-center'>
                  <RiEqualizer2Line className='mr-2 h-4 w-4 text-text-tertiary' />
                  <div className='system-sm-semibold text-text-secondary'>{t('common.operation.edit')}</div>
                </div>
              ),
            },
          ]
          : []
      ),
    ]
    if (type === CredentialTypeEnum.OAUTH2) {
      const oAuthItems = [
        {
          value: 'change',
          text: (
            <div className='flex items-center'>
              <RiStickyNoteAddLine className='mr-2 h-4 w-4 text-text-tertiary' />
              <div className='system-sm-semibold mb-1 text-text-secondary'>{t('common.dataSource.notion.changeAuthorizedPages')}</div>
            </div>
          ),
        },
      ]
      commonItems.push(...oAuthItems)
    }
    return commonItems
  }, [t, type])

  const secondItems = useMemo(() => {
    return [
      {
        value: 'delete',
        text: (
          <div className='flex items-center'>
            <RiDeleteBinLine className='mr-2 h-4 w-4 text-text-tertiary' />
            <div className='system-sm-semibold text-text-secondary'>
              {t('common.operation.remove')}
            </div>
          </div>
        ),
      },
    ]
  }, [])
  const handleSelect = useCallback((item: Item) => {
    if (item.value === 'rename') {
      onRename?.()
      return
    }
    onAction(
      item.value as string,
      credentialItem,
    )
  }, [onAction, credentialItem, onRename])

  return (
    <Dropdown
      items={items}
      secondItems={secondItems}
      onSelect={handleSelect}
      popupClassName='z-[61]'
      triggerProps={{
        size: 'l',
      }}
      itemClassName='py-2 h-auto hover:bg-state-base-hover'
      secondItemClassName='py-2 h-auto hover:bg-state-base-hover'
    />
  )
}

export default memo(Operator)
