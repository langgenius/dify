'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import TextEditor from '../../_base/components/editor/text-editor'
import type { Memory } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  instruction: string
  onInstructionChange: (instruction: string) => void
  memory: Memory
}

const AdvancedSetting: FC<Props> = ({
  instruction,
  onInstructionChange,
  memory,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <TextEditor
        title={t(`${i18nPrefix}.instruction`)!}
        value={instruction}
        onChange={onInstructionChange}
        minHeight={160}
        placeholder={t(`${i18nPrefix}.instructionPlaceholder`)!}
        headerRight={(
          <div className='flex items-center h-full'>
            <div className='text-xs font-medium text-gray-500'>{instruction.length}</div>
            <div className='mx-3 h-3 w-px bg-gray-200'></div>
          </div>
        )}
      />
    </div>
  )
}
export default React.memo(AdvancedSetting)
