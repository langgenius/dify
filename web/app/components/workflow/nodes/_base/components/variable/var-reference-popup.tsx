'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferenceVars from './var-reference-vars'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import ListEmpty from '@/app/components/base/list-empty'
import { useDocLink } from '@/context/i18n'

type Props = {
  vars: NodeOutPutVar[]
  popupFor?: 'assigned' | 'toAssigned'
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
  isSupportFileVar?: boolean
  zIndex?: number
}
const VarReferencePopup: FC<Props> = ({
  vars,
  popupFor,
  onChange,
  itemWidth,
  isSupportFileVar = true,
  zIndex,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div className='space-y-1 rounded-lg border border-components-panel-border bg-components-panel-bg p-1 shadow-lg' style={{
      width: itemWidth || 228,
    }}>
      {((!vars || vars.length === 0) && popupFor)
        ? (popupFor === 'toAssigned'
          ? (
            <ListEmpty
              title={t('workflow.variableReference.noAvailableVars') || ''}
              description={<div className='system-xs-regular text-text-tertiary'>
                {t('workflow.variableReference.noVarsForOperation')}
              </div>}
            />
          )
          : (
            <ListEmpty
              title={t('workflow.variableReference.noAssignedVars') || ''}
              description={<div className='system-xs-regular text-text-tertiary'>
                {t('workflow.variableReference.assignedVarsDescription')}
                <a target='_blank' rel='noopener noreferrer'
                  className='text-text-accent-secondary'
                  href={docLink('/guides/workflow/variables#conversation-variables', {
                    'zh-Hans': '/guides/workflow/variables#会话变量',
                    'ja-JP': '/guides/workflow/variables#会話変数',
                  })}>
                  {t('workflow.variableReference.conversationVars')}
                </a>
              </div>}
            />
          ))
        : <VarReferenceVars
          searchBoxClassName='mt-1'
          vars={vars}
          onChange={onChange}
          itemWidth={itemWidth}
          isSupportFileVar={isSupportFileVar}
          zIndex={zIndex}
        />
      }
    </div >
  )
}
export default React.memo(VarReferencePopup)
