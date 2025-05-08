'use client'
import React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import {
  RiCloseLine,
} from '@remixicon/react'
import type { ToolWithProvider } from '../../../workflow/types'
import Icon from '@/app/components/plugins/card/base/card-icon'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
// import Toast from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'

type Props = {
  detail?: ToolWithProvider
  onUpdate: () => void
  onHide: () => void
}

const MCPDetailContent: FC<Props> = ({
  detail,
  // onUpdate,
  onHide,
}) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()

  if (!detail)
    return null

  return (
    <>
      <div className={cn('shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3')}>
        <div className='flex'>
          <div className='shrink-0 overflow-hidden rounded-xl border border-components-panel-border-subtle'>
            <Icon src={detail.icon} />
          </div>
          <div className='ml-3 w-0 grow'>
            <div className='flex h-5 items-center'>
              <div className='system-md-semibold truncate text-text-primary' title={detail.name}>{detail.name}</div>
            </div>
            <div className='system-xs-regular mt-0.5 truncate text-text-tertiary' title={detail.server_url}>{detail.server_url}</div>
          </div>
          <div className='flex gap-1'>
            {/* <OperationDropdown
              source={detail.source}
              onInfo={showPluginInfo}
              onCheckVersion={handleUpdate}
              onRemove={showDeleteConfirm}
              detailUrl={detailUrl}
            /> */}
            <ActionButton onClick={onHide}>
              <RiCloseLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        <div className='mt-5'>
          {detail.is_team_authorization && (
            <Button
              variant='secondary'
              className='w-full'
              // onClick={() => setShowSettingAuth(true)}
              disabled={!isCurrentWorkspaceManager}
            >
              <Indicator className='mr-2' color={'green'} />
              {t('tools.auth.authorized')}
            </Button>
          )}
          {detail.is_team_authorization && (
            <Button
              variant='primary'
              className='w-full'
              // onClick={() => setShowSettingAuth(true)}
              disabled={!isCurrentWorkspaceManager}
            >{t('tools.auth.unauthorized')}</Button>
          )}
        </div>
      </div>
      <div className='grow overflow-y-auto'>
        TOOL list
      </div>
    </>
  )
}

export default MCPDetailContent
