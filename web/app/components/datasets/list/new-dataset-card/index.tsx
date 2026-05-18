'use client'
import {
  RiAddLine,
  RiFunctionAddLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'
import Option from './option'

const CreateAppCard = () => {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canAddDataset = hasPermission(workspacePermissionKeys, 'dataset.create')
  const canConnectExternalDataset = hasPermission(workspacePermissionKeys, 'dataset.external.connect')

  return (
    <div className="flex h-47.5 flex-col gap-y-0.5 rounded-xl bg-background-default-dimmed">
      <div className="flex grow flex-col items-center justify-center p-2">
        <Option
          disabled={!canAddDataset}
          href="/datasets/create"
          Icon={RiAddLine}
          text={t('createDataset', { ns: 'dataset' })}
        />
        <Option
          disabled={!canAddDataset}
          href="/datasets/create-from-pipeline"
          Icon={RiFunctionAddLine}
          text={t('createFromPipeline', { ns: 'dataset' })}
        />
      </div>
      <div className="border-t-[0.5px] border-divider-subtle p-2">
        <Option
          disabled={!canConnectExternalDataset}
          href="/datasets/connect"
          Icon={ApiConnectionMod}
          text={t('connectDataset', { ns: 'dataset' })}
        />
      </div>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
