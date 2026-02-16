'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import { MessageClockCircle } from '@/app/components/base/icons/src/vender/solid/general'

type Props = {
  showWarning: boolean
  onShowEditModal: () => void
}

const HistoryPanel: FC<Props> = ({
  showWarning,
  onShowEditModal,
}) => {
  const { t } = useTranslation()
  return (
    <Panel
      className="mt-2"
      title={(
        <div className="flex items-center gap-2">
          <div>{t('feature.conversationHistory.title', { ns: 'appDebug' })}</div>
        </div>
      )}
      headerIcon={(
        <div className="rounded-md p-1 shadow-xs">
          <MessageClockCircle className="h-4 w-4 text-[#DD2590]" />
        </div>
      )}
      headerRight={(
        <div className="flex items-center">
          <div className="text-xs text-text-tertiary">{t('feature.conversationHistory.description', { ns: 'appDebug' })}</div>
          <div className="ml-3 h-[14px] w-[1px] bg-divider-regular"></div>
          <OperationBtn type="edit" onClick={onShowEditModal} />
        </div>
      )}
      noBodySpacing
    >
      {showWarning && (
        <div className="flex justify-between rounded-b-xl bg-background-section-burn px-3 py-2 text-xs text-text-secondary">
          <div>
            {t('feature.conversationHistory.tip', { ns: 'appDebug' })}
          </div>
        </div>
      )}
    </Panel>
  )
}
export default React.memo(HistoryPanel)
