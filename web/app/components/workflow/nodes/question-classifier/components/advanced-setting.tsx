'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import TextEditor from '../../_base/components/editor/text-editor'
import MemoryConfig from '../../_base/components/memory-config'
import type { Memory } from '@/app/components/workflow/types'
const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  instruction: string
  onInstructionChange: (instruction: string) => void
  hideMemorySetting: boolean
  memory?: Memory
  onMemoryChange: (memory?: Memory) => void
  readonly?: boolean
}

const AdvancedSetting: FC<Props> = ({
  instruction,
  onInstructionChange,
  hideMemorySetting,
  memory,
  onMemoryChange,
  readonly,
}) => {
  const { t } = useTranslation()

  return (
    <>
      <TextEditor
        isInNode
        title={t(`${i18nPrefix}.instruction`)!}
        value={instruction}
        onChange={onInstructionChange}
        minHeight={160}
        placeholder={t(`${i18nPrefix}.instructionPlaceholder`)!}
        headerRight={(
          <div className='flex items-center h-full'>
            <div className='text-xs font-medium text-gray-500'>{instruction?.length || 0}</div>
            <div className='mx-3 h-3 w-px bg-gray-200'></div>
          </div>
        )}
        readonly={readonly}
      />
      {!hideMemorySetting && (
        <MemoryConfig
          className='mt-4'
          readonly={false}
          config={{ data: memory }}
          onChange={onMemoryChange}
          canSetRoleName={false}
        />
      )}
    </>
  )
}
export default React.memo(AdvancedSetting)
