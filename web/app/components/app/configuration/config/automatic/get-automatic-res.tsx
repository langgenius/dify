'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
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

const genIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.6665 1.33332C3.6665 0.965133 3.36803 0.666656 2.99984 0.666656C2.63165 0.666656 2.33317 0.965133 2.33317 1.33332V2.33332H1.33317C0.964981 2.33332 0.666504 2.6318 0.666504 2.99999C0.666504 3.36818 0.964981 3.66666 1.33317 3.66666H2.33317V4.66666C2.33317 5.03485 2.63165 5.33332 2.99984 5.33332C3.36803 5.33332 3.6665 5.03485 3.6665 4.66666V3.66666H4.6665C5.03469 3.66666 5.33317 3.36818 5.33317 2.99999C5.33317 2.6318 5.03469 2.33332 4.6665 2.33332H3.6665V1.33332Z" fill="white" />
    <path d="M3.6665 11.3333C3.6665 10.9651 3.36803 10.6667 2.99984 10.6667C2.63165 10.6667 2.33317 10.9651 2.33317 11.3333V12.3333H1.33317C0.964981 12.3333 0.666504 12.6318 0.666504 13C0.666504 13.3682 0.964981 13.6667 1.33317 13.6667H2.33317V14.6667C2.33317 15.0348 2.63165 15.3333 2.99984 15.3333C3.36803 15.3333 3.6665 15.0348 3.6665 14.6667V13.6667H4.6665C5.03469 13.6667 5.33317 13.3682 5.33317 13C5.33317 12.6318 5.03469 12.3333 4.6665 12.3333H3.6665V11.3333Z" fill="white" />
    <path d="M9.28873 1.76067C9.18971 1.50321 8.94235 1.33332 8.6665 1.33332C8.39066 1.33332 8.1433 1.50321 8.04427 1.76067L6.88815 4.76658C6.68789 5.28727 6.62495 5.43732 6.53887 5.55838C6.4525 5.67986 6.34637 5.78599 6.2249 5.87236C6.10384 5.95844 5.95379 6.02137 5.43309 6.22164L2.42718 7.37776C2.16972 7.47678 1.99984 7.72414 1.99984 7.99999C1.99984 8.27584 2.16972 8.5232 2.42718 8.62222L5.43309 9.77834C5.95379 9.97861 6.10384 10.0415 6.2249 10.1276C6.34637 10.214 6.4525 10.3201 6.53887 10.4416C6.62495 10.5627 6.68789 10.7127 6.88816 11.2334L8.04427 14.2393C8.1433 14.4968 8.39066 14.6667 8.6665 14.6667C8.94235 14.6667 9.18971 14.4968 9.28873 14.2393L10.4449 11.2334C10.6451 10.7127 10.7081 10.5627 10.7941 10.4416C10.8805 10.3201 10.9866 10.214 11.1081 10.1276C11.2292 10.0415 11.3792 9.97861 11.8999 9.77834L14.9058 8.62222C15.1633 8.5232 15.3332 8.27584 15.3332 7.99999C15.3332 7.72414 15.1633 7.47678 14.9058 7.37776L11.8999 6.22164C11.3792 6.02137 11.2292 5.95844 11.1081 5.87236C10.9866 5.78599 10.8805 5.67986 10.7941 5.55838C10.7081 5.43732 10.6451 5.28727 10.4449 4.76658L9.28873 1.76067Z" fill="white" />
  </svg>
)

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

  const [audiences, setAudiences] = React.useState<string>('')
  const [hopingToSolve, setHopingToSolve] = React.useState<string>('')
  const isValid = () => {
    if (audiences.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('appDebug.automatic.audiencesRequired'),
      })
      return false
    }
    if (hopingToSolve.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('appDebug.automatic.problemRequired'),
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
      <div className='text-[13px] text-gray-400'>{t('appDebug.automatic.loading')}</div>
    </div>
  )

  const renderNoData = (
    <div className='w-0 grow flex flex-col items-center px-8 justify-center h-full space-y-3'>
      {noDataIcon}
      <div className='text-[13px] text-gray-400'>{t('appDebug.automatic.noData')}</div>
    </div>
  )

  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      const res = await generateRule({
        audiences,
        hoping_to_solve: hopingToSolve,
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
      className='!p-0 sm:min-w-[768px] xl:min-w-[1120px]'
      closable
    >
      <div className='flex h-[680px] flex-wrap gap-y-4 overflow-y-auto'>
        {isShowAutoPromptInput() && <div className='w-full sm:w-[360px] xl:w-[480px] shrink-0 px-8 py-6 h-full overflow-y-auto border-r border-gray-100'>
          <div>
            <div className='mb-1 text-xl font-semibold text-primary-600'>{t('appDebug.automatic.title')}</div>
            <div className='text-[13px] font-normal text-gray-500'>{t('appDebug.automatic.description')}</div>
          </div>
          {/* inputs */}
          <div className='mt-2 space-y-5'>
            <div className='space-y-2'>
              <div className='text-[13px] font-medium text-gray-900'>{t('appDebug.automatic.intendedAudience')}</div>
              <input className="w-full h-8 px-3 text-[13px] font-normal bg-gray-50 rounded-lg" placeholder={t('appDebug.automatic.intendedAudiencePlaceHolder') as string} value={audiences} onChange={e => setAudiences(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <div className='text-[13px] font-medium text-gray-900'>{t('appDebug.automatic.solveProblem')}</div>
              <textarea className="w-full h-[200px] overflow-y-auto p-3 text-[13px] font-normal bg-gray-50 rounded-lg" placeholder={t('appDebug.automatic.solveProblemPlaceHolder') as string} value={hopingToSolve} onChange={e => setHopingToSolve(e.target.value)} />
            </div>

            <div className='mt-6 flex justify-end'>
              <Button
                className='flex space-x-2'
                variant='primary'
                onClick={onGenerate}
                disabled={isLoading}
              >
                {genIcon}
                <span className='text-xs font-semibold text-white uppercase'>{t('appDebug.automatic.generate')}</span>
              </Button>
            </div>
          </div>
        </div>}

        {(!isLoading && res) && (
          <div className='w-0 grow px-8 pt-6 h-full overflow-y-auto'>
            <div className='mb-4 text-lg font-medium text-gray-900'>{t('appDebug.automatic.resTitle')}</div>

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
              }}>{t('appDebug.automatic.apply')}</Button>
            </div>
          </div>
        )}
        {isLoading && renderLoading}
        {isShowAutoPromptResPlaceholder() && renderNoData}
        {showConfirmOverwrite && (
          <Confirm
            title={t('appDebug.automatic.overwriteTitle')}
            content={t('appDebug.automatic.overwriteMessage')}
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
