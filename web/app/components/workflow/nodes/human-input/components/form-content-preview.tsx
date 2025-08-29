'use client'
import type { FC } from 'react'
import React from 'react'
import type { FormInputItem, UserAction } from '../types'
import { useStore } from '@/app/components/workflow/store'
import { Markdown } from '@/app/components/base/markdown'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import Button from '@/app/components/base/button'
import Badge from '@/app/components/base/badge'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { RiCloseLine } from '@remixicon/react'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  content: string
  formInputs: FormInputItem[]
  userActions: UserAction[]
  onClose: () => void
}

const FormContentPreview: FC<Props> = ({
  content,
  formInputs,
  userActions,
  onClose,
}) => {
  const { t } = useTranslation()
  const panelWidth = useStore(state => state.panelWidth)

  return (
    <div className='fixed top-[112px] z-10 max-h-[calc(100vh-116px)] w-[600px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-3 shadow-xl' style={{
      right: panelWidth + 8,
    }}>
      <div className='flex h-[26px] items-center justify-between px-4'>
        <Badge uppercase className='border-text-accent-secondary text-text-accent-secondary'>{t(`${i18nPrefix}.formContent.preview`)}</Badge>
        <ActionButton onClick={onClose}><RiCloseLine className='w-5 text-text-tertiary' /></ActionButton>
      </div>
      <div className='max-h-[calc(100vh-167px)] overflow-y-auto px-4'>
        <Markdown content={content} />
        <div className='mt-3 flex flex-wrap gap-1 py-1'>
          {userActions.map((action: any) => (
            <Button
              key={action.id}
              variant={getButtonStyle(action.button_style) as any}
            >
              {action.title}
            </Button>
          ))}
        </div>
        <div className='system-xs-regular mt-1 px-4 text-text-tertiary'>In preview mode, action buttons are not functional.</div>
      </div>
    </div>
  )
}
export default React.memo(FormContentPreview)
