'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import VarReferenceVars from './var-reference-vars'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import ListEmpty from '@/app/components/base/list-empty'
import { LanguagesSupported } from '@/i18n/language'
import I18n from '@/context/i18n'

type Props = {
  vars: NodeOutPutVar[]
  popupFor?: 'assigned' | 'toAssigned'
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
  isSupportFileVar?: boolean
}
const VarReferencePopup: FC<Props> = ({
  vars,
  popupFor,
  onChange,
  itemWidth,
  isSupportFileVar = true,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div className='space-y-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg' style={{
      width: itemWidth || 228,
    }}>
      {((!vars || vars.length === 0) && popupFor)
        ? (popupFor === 'toAssigned'
          ? (
            <ListEmpty
              title={t('workflow.variableReference.noAvailableVars') || ''}
              description={<div className='text-text-tertiary system-xs-regular'>
                {t('workflow.variableReference.noVarsForOperation')}
              </div>}
            />
          )
          : (
            <ListEmpty
              title={t('workflow.variableReference.noAssignedVars') || ''}
              description={<div className='text-text-tertiary system-xs-regular'>
                {t('workflow.variableReference.assignedVarsDescription')}
                <a target='_blank' rel='noopener noreferrer'
                  className='text-text-accent-secondary'
                  href={locale !== LanguagesSupported[1] ? 'https://docs.dify.ai/guides/workflow/variables#conversation-variables' : `https://docs.dify.ai/${locale.toLowerCase()}/guides/workflow/variables#hui-hua-bian-liang`}>{t('workflow.variableReference.conversationVars')}</a>
              </div>}
            />
          ))
        : <VarReferenceVars
          searchBoxClassName='mt-1'
          vars={vars}
          onChange={onChange}
          itemWidth={itemWidth}
          isSupportFileVar={isSupportFileVar}
        />
      }
    </div >
  )
}
export default React.memo(VarReferencePopup)
