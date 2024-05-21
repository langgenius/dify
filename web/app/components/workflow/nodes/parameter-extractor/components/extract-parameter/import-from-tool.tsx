'use client'
import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import BlockSelector from '../../../../block-selector'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  onImport: () => void
}

const ImportFromTool: FC<Props> = ({
  onImport,
}) => {
  const { t } = useTranslation()

  const renderTrigger = useCallback((open: boolean) => {
    return (
      <div>
        <div className={cn(
          'flex items-center h-6 px-2 cursor-pointer rounded-md hover:bg-gray-100 text-xs font-medium text-gray-500',
          open && 'bg-gray-100',
        )}>
          {t(`${i18nPrefix}.importFromTool`)}
        </div>
      </div>
    )
  }, [t])

  return (
    <BlockSelector
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 52,
      }}
      trigger={renderTrigger}
      onSelect={onImport}
      noBlocks
    />
  )
}
export default memo(ImportFromTool)
