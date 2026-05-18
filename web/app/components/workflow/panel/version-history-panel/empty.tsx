import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { RiHistoryLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type EmptyProps = {
  onResetFilter: () => void
}

const Empty: FC<EmptyProps> = ({
  onResetFilter,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-5/6 w-full flex-col justify-center gap-y-2">
      <div className="flex justify-center">
        <RiHistoryLine className="h-10 w-10 text-text-empty-state-icon" />
      </div>
      <div className="flex justify-center system-xs-regular text-text-tertiary">
        {t('versionHistory.filter.empty', { ns: 'workflow' })}
      </div>
      <div className="flex justify-center">
        <Button nativeButton={false} size="small" onClick={onResetFilter}>
          {t('versionHistory.filter.reset', { ns: 'workflow' })}
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Empty)
