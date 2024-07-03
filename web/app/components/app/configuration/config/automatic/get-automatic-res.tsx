'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { generateRule } from '@/service/debug'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import { AppType } from '@/types/app'
import ConfigVar from '@/app/components/app/configuration/config-var'
import OpeningStatement from '@/app/components/app/configuration/features/chat-group/opening-statement'
import GroupName from '@/app/components/app/configuration/base/group-name'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'

// type
import type { AutomaticRes } from '@/service/debug'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { Generator } from '@/app/components/base/icons/src/vender/other'

const noDataIcon = (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.4998 51.3333V39.6666M10.4998 16.3333V4.66663M4.6665 10.5H16.3332M4.6665 45.5H16.3332M30.3332 6.99996L26.2868 17.5206C25.6287 19.2315 25.2997 20.0869 24.7881 20.8065C24.3346 21.4442 23.7774 22.0014 23.1397 22.4549C22.4202 22.9665 21.5647 23.2955 19.8538 23.9535L9.33317 28L19.8539 32.0464C21.5647 32.7044 22.4202 33.0334 23.1397 33.5451C23.7774 33.9985 24.3346 34.5557 24.7881 35.1934C25.2997 35.913 25.6287 36.7684 26.2868 38.4793L30.3332 49L34.3796 38.4793C35.0376 36.7684 35.3666 35.913 35.8783 35.1934C36.3317 34.5557 36.8889 33.9985 37.5266 33.5451C38.2462 33.0334 39.1016 32.7044 40.8125 32.0464L51.3332 28L40.8125 23.9535C39.1016 23.2955 38.2462 22.9665 37.5266 22.4549C36.8889 22.0014 36.3317 21.4442 35.8783 20.8065C35.3666 20.0869 35.0376 19.2315 34.3796 17.5206L30.3332 6.99996Z" stroke="#EAECF0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export type IGetAutomaticResProps = {
  mode: AppType
  isShow: boolean
  onClose: () => void
  onFinished: (res: AutomaticRes) => void
}

const TryLabel: FC<{
  Icon: any
  text: string
  onClick: () => void
}> = ({ Icon, text, onClick }) => {
  return (
    <div
      className='mt-2 mr-1 shrink-0 flex h-7 items-center px-2 bg-gray-100 rounded-lg cursor-pointer'
      onClick={onClick}
    >
      <Icon className='w-4 h-4 text-gray-500'></Icon>
      <div className='ml-1 text-xs font-medium text-gray-700'>{text}</div>
    </div>
  )
}

const GetAutomaticRes: FC<IGetAutomaticResProps> = ({
  mode,
  isShow,
  onClose,
  // appId,
  onFinished,
}) => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const tryList = [
    {
      icon: Generator,
      text: 'Write me an email',
    },
    {
      icon: Generator,
      text: 'Generate an SEO article',
    },
    {
      icon: Generator,
      text: 'Code debug',
    },
    {
      icon: Generator,
      text: 'Translate English to Chinese',
    },
  ]

  const [instruction, setInstruction] = React.useState<string>('')
  const isValid = () => {
    if (instruction.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: t('appDebug.generate.instruction'),
        }),
      })
      return false
    }
    return true
  }
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [res, setRes] = React.useState<AutomaticRes | null>(null)

  const renderLoading = (
    <div className='w-0 grow flex flex-col items-center justify-center h-full space-y-3'>
      <Loading />
      <div className='text-[13px] text-gray-400'>{t('appDebug.generate.loading')}</div>
    </div>
  )

  const renderNoData = (
    <div className='w-0 grow flex flex-col items-center px-8 justify-center h-full space-y-3'>
      {noDataIcon}
      <div className='text-[13px] text-gray-400'>{t('appDebug.generate.noData')}</div>
    </div>
  )

  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      // TODO: wait for api
      const res = await generateRule({
        hoping_to_solve: instruction,
      })
      setRes(res)
    }
    finally {
      setLoadingFalse()
    }
  }

  const [showConfirmOverwrite, setShowConfirmOverwrite] = React.useState(false)

  const isShowAutoPromptInput = () => {
    if (isMobile) {
      // hide prompt panel on mobile if it is loading or has had result
      if (isLoading || res)
        return false
      return true
    }

    // always display prompt panel on desktop mode
    return true
  }

  const isShowAutoPromptResPlaceholder = () => {
    if (isMobile) {
      // hide placeholder panel on mobile
      return false
    }

    return !isLoading && !res
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='!p-0 min-w-[1140px]'
      closable
    >
      <div className='flex h-[680px] flex-wrap space-y-4 overflow-y-auto'>
        {isShowAutoPromptInput() && <div className='w-[570px] shrink-0 p-6 h-full overflow-y-auto border-r border-gray-100'>
          <div className='mb-8'>
            <div className={`leading-[28px] text-lg font-bold ${s.textGradient}`}>{t('appDebug.generate.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-gray-500'>{t('appDebug.generate.description')}</div>
          </div>
          <div >
            <div className='flex items-center'>
              <div className='mr-3 shrink-0 leading-[18px] text-xs font-semibold text-gray-500 uppercase'>{t('appDebug.generate.tryIt')}</div>
              <div className='grow h-px' style={{
                background: 'linear-gradient(to right, rgba(243, 244, 246, 1), rgba(243, 244, 246, 0))',
              }}></div>
            </div>
            <div className='flex flex-wrap'>
              {tryList.map(item => (
                <TryLabel
                  key={item.text}
                  Icon={item.icon}
                  text={item.text}
                  onClick={() => { }}
                />
              ))}
            </div>
          </div>
          {/* inputs */}
          <div className='mt-6'>
            <div className='text-[0px]'>
              <div className='mb-2 leading-5 text-sm font-medium text-gray-900'>{t('appDebug.generate.instruction')}</div>
              <textarea className="w-full h-[200px] overflow-y-auto px-3 py-2 text-sm bg-gray-50 rounded-lg" placeholder={t('appDebug.generate.instructionPlaceHolder') as string} value={instruction} onChange={e => setInstruction(e.target.value)} />
            </div>

            <div className='mt-5 flex justify-end'>
              <Button
                className='flex space-x-1'
                variant='primary'
                onClick={onGenerate}
                disabled={isLoading}
              >
                <Generator className='w-4 h-4 text-white' />
                <span className='text-xs font-semibold text-white'>{t('appDebug.generate.generate')}</span>
              </Button>
            </div>
          </div>
        </div>}

        {(!isLoading && res) && (
          <div className='w-0 grow p-6 h-full overflow-y-auto'>
            <div className='mb-4 text-lg font-medium text-gray-900'>{t('appDebug.generate.resTitle')}</div>

            <ConfigPrompt
              mode={mode}
              promptTemplate={res?.prompt || ''}
              promptVariables={[]}
              readonly
            />

            {(res?.variables?.length && res?.variables?.length > 0)
              ? (
                <ConfigVar
                  promptVariables={res?.variables.map(key => ({ key, name: key, type: 'string', required: true })) || []}
                  readonly
                />
              )
              : ''}

            {(mode !== AppType.completion && res?.opening_statement) && (
              <div className='mt-7'>
                <GroupName name={t('appDebug.feature.groupChat.title')} />
                <OpeningStatement
                  value={res?.opening_statement || ''}
                  readonly
                />
              </div>
            )}

            <div className='sticky bottom-0 flex justify-end right-0 py-4 bg-white'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' className='ml-2' onClick={() => {
                setShowConfirmOverwrite(true)
              }}>{t('appDebug.generate.apply')}</Button>
            </div>
          </div>
        )}
        {isLoading && renderLoading}
        {isShowAutoPromptResPlaceholder() && renderNoData}
        {showConfirmOverwrite && (
          <Confirm
            title={t('appDebug.generate.overwriteTitle')}
            content={t('appDebug.generate.overwriteMessage')}
            isShow={showConfirmOverwrite}
            onClose={() => setShowConfirmOverwrite(false)}
            onConfirm={() => {
              setShowConfirmOverwrite(false)
              onFinished(res!)
            }}
            onCancel={() => setShowConfirmOverwrite(false)}
          />
        )}
      </div>
    </Modal>
  )
}
export default React.memo(GetAutomaticRes)
