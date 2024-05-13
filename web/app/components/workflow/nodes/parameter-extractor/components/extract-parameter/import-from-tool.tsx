'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  onImport: () => void
}

const ImportFromTool: FC<Props> = ({
  onImport,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='flex items-center h-6 px-2 cursor-pointer rounded-md hover:bg-gray-100 text-xs font-medium text-gray-500' >
        {t(`${i18nPrefix}.importFromTool`)}
      </div>
    </div>
  )
}
export default React.memo(ImportFromTool)
