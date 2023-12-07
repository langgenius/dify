'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname, useRouter } from 'next/navigation'
import VarPicker from '../../dataset-config/context-var/var-picker'
import ScoreSlider from './score-slider'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { HelpCircle, LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { AppType } from '@/types/app'
import ConfigContext from '@/context/debug-configuration'

type Props = {}

const Item: FC<{ title: string; tooltip: string; children: JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className='flex items-center space-x-1'>
        <div>{title}</div>
        <TooltipPlus
          popupContent={
            <div className='max-w-[200px] leading-[18px] text-[13px] font-medium text-gray-800'>{tooltip}</div>
          }
        >
          <HelpCircle className='w-3.5 h-3.5 text-gray-400' />
        </TooltipPlus>
      </div>
      <div>{children}</div>
    </div>
  )
}

const AnnotationReplyConfig: FC<Props> = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const {
    mode,
    modelConfig,
  } = useContext(ConfigContext)
  const promptVariables = modelConfig.configs.prompt_variables
  const promptVariablesToSelect = promptVariables.map(item => ({
    name: item.name,
    type: item.type,
    value: item.key,
  }))
  const [scoreThreshold, setScoreThreshold] = useState(90)
  const [matchVariable, setMatchVariable] = useState('')
  return (
    <Panel
      className="mt-4"
      headerIcon={
        <MessageFast className='w-4 h-4 text-[#444CE7]' />
      }
      title={t('appDebug.feature.annotation.title')}
      headerRight={
        <div className='flex items-center space-x-1 leading-[18px] text-xs font-medium text-gray-700 cursor-pointer' onClick={() => {
          router.push(`/app/${appId}/annotation`)
        }}>
          <div>{t('appDebug.feature.annotation.cacheManagement')}</div>
          <LinkExternal02 className='w-3.5 h-3.5' />
        </div>
      }
    >
      <div className='p-4 pt-3 rounded-lg border border-gray-200 bg-white space-y-2'>
        <Item
          title={t('appDebug.feature.annotation.scoreThreshold.title')}
          tooltip={t('appDebug.feature.annotation.scoreThreshold.description')}
        >
          <ScoreSlider
            className='mt-1'
            value={scoreThreshold}
            onChange={setScoreThreshold}
          />
        </Item>
        {mode === AppType.completion && (
          <Item
            title={t('appDebug.feature.annotation.matchVariable.title')}
            tooltip={t('appDebug.feature.annotation.matchVariable.description')}
          >
            <VarPicker
              triggerClassName='mt-2 w-full'
              className='!justify-between'
              value={matchVariable}
              options={promptVariablesToSelect}
              onChange={setMatchVariable}
              notSelectedVarTip={t('appDebug.feature.annotation.matchVariable.choosePlaceholder')}
            />
          </Item>
        )}

      </div>
    </Panel>
  )
}
export default React.memo(AnnotationReplyConfig)
