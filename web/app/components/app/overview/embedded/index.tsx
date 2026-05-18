import type { MutableRefObject } from 'react'
import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from '../app-card-utils'
import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useThemeContext } from '@/app/components/base/chat/embedded-chatbot/theme/theme-context'
import { InputVarType } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { basePath } from '@/utils/var'
import {
  compressAndEncodeBase64,
  createWorkflowLaunchInitialValues,
  getChromePluginContent,
  getEmbeddedIframeSnippet,
  getEmbeddedScriptSnippet,
  isWorkflowLaunchInputSupported,
} from '../app-card-utils'
import WorkflowHiddenInputFields from '../workflow-hidden-input-fields'
import style from './style.module.css'

type Props = {
  siteInfo?: SiteInfo
  isShow: boolean
  onClose: () => void
  accessToken?: string
  appBaseUrl?: string
  hiddenInputs?: WorkflowHiddenStartVariable[]
  className?: string
}

const OPTION_KEYS = ['iframe', 'scripts', 'chromePlugin'] as const
const prefixEmbedded = 'overview.appInfo.embedded'

type Option = typeof OPTION_KEYS[number]

const optionIconClassName: Record<Option, string> = {
  iframe: style.iframeIcon!,
  scripts: style.scriptsIcon!,
  chromePlugin: style.chromePluginIcon!,
}

const getSerializedHiddenInputValue = (
  variable: WorkflowHiddenStartVariable,
  values: Record<string, WorkflowLaunchInputValue>,
) => {
  const rawValue = values[variable.variable]
  if (variable.type === InputVarType.checkbox)
    return String(Boolean(rawValue))

  return String(rawValue ?? '')
}

const buildEmbeddedIframeUrl = async ({
  appBaseUrl,
  accessToken,
  variables,
  values,
}: {
  appBaseUrl: string
  accessToken: string
  variables: WorkflowHiddenStartVariable[]
  values: Record<string, WorkflowLaunchInputValue>
}) => {
  const iframeUrl = new URL(`${appBaseUrl}${basePath}/chatbot/${accessToken}`, window.location.origin)

  await Promise.all(variables.map(async (variable) => {
    iframeUrl.searchParams.set(variable.variable, await compressAndEncodeBase64(getSerializedHiddenInputValue(variable, values)))
  }))

  return iframeUrl.toString()
}

const AsyncEmbeddedOptionContent = ({
  option,
  iframeUrlPromise,
  latestResolvedIframeUrlRef,
}: {
  option: Option
  iframeUrlPromise: Promise<string>
  latestResolvedIframeUrlRef: MutableRefObject<string>
}) => {
  const iframeUrl = use(iframeUrlPromise)
  latestResolvedIframeUrlRef.current = iframeUrl

  if (option === 'chromePlugin')
    return getChromePluginContent(iframeUrl)

  return getEmbeddedIframeSnippet(iframeUrl)
}

const EmbeddedContent = ({
  siteInfo,
  appBaseUrl,
  accessToken,
  hiddenInputs,
}: Required<Pick<Props, 'accessToken' | 'appBaseUrl'>> & Pick<Props, 'siteInfo' | 'hiddenInputs'>) => {
  const { t } = useTranslation()
  const supportedHiddenInputs = useMemo<WorkflowHiddenStartVariable[]>(
    () => (hiddenInputs ?? []).filter(isWorkflowLaunchInputSupported),
    [hiddenInputs],
  )
  const initialHiddenInputValues = useMemo(
    () => createWorkflowLaunchInitialValues(supportedHiddenInputs),
    [supportedHiddenInputs],
  )
  const [option, setOption] = useState<Option>('iframe')
  const [copiedOption, setCopiedOption] = useState<Option | null>(null)
  const [hiddenInputsCollapsed, setHiddenInputsCollapsed] = useState(true)
  const [hiddenInputValues, setHiddenInputValues] = useState<Record<string, WorkflowLaunchInputValue>>(
    () => initialHiddenInputValues,
  )
  const [previewIframeUrlPromise, setPreviewIframeUrlPromise] = useState<Promise<string>>(
    () => buildEmbeddedIframeUrl({
      appBaseUrl,
      accessToken,
      variables: supportedHiddenInputs,
      values: initialHiddenInputValues,
    }),
  )
  const latestResolvedIframeUrlRef = useRef('')

  const { langGeniusVersionInfo } = useAppContext()
  const themeBuilder = useThemeContext()
  const isTestEnv = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'

  const handleHiddenInputValueChange = (variable: string, value: WorkflowLaunchInputValue) => {
    const nextHiddenInputValues = {
      ...hiddenInputValues,
      [variable]: value,
    }

    setCopiedOption(null)
    setHiddenInputValues(nextHiddenInputValues)
    setPreviewIframeUrlPromise(buildEmbeddedIframeUrl({
      appBaseUrl,
      accessToken,
      variables: supportedHiddenInputs,
      values: nextHiddenInputValues,
    }))
  }
  const scriptsContent = useMemo(() => getEmbeddedScriptSnippet({
    url: appBaseUrl,
    token: accessToken,
    primaryColor: themeBuilder.theme?.primaryColor ?? '#1C64F2',
    isTestEnv,
    inputValues: hiddenInputValues,
  }), [accessToken, appBaseUrl, hiddenInputValues, isTestEnv, themeBuilder.theme?.primaryColor])

  const onClickCopy = async () => {
    const latestIframeUrl = await buildEmbeddedIframeUrl({
      appBaseUrl,
      accessToken,
      variables: supportedHiddenInputs,
      values: hiddenInputValues,
    })

    if (option === 'chromePlugin') {
      const splitUrl = getChromePluginContent(latestIframeUrl).split(': ')
      if (splitUrl.length > 1)
        copy(splitUrl[1]!)
    }
    else if (option === 'iframe') {
      copy(getEmbeddedIframeSnippet(latestIframeUrl))
    }
    else {
      copy(scriptsContent)
    }
    setCopiedOption(option)
  }
  const previewFallback = latestResolvedIframeUrlRef.current
    ? (option === 'chromePlugin'
        ? getChromePluginContent(latestResolvedIframeUrlRef.current)
        : getEmbeddedIframeSnippet(latestResolvedIframeUrlRef.current))
    : ''

  const navigateToChromeUrl = () => {
    window.open('https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf', '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    themeBuilder.buildTheme(siteInfo?.chat_color_theme ?? null, siteInfo?.chat_color_theme_inverted ?? false)
  }, [siteInfo?.chat_color_theme, siteInfo?.chat_color_theme_inverted, themeBuilder])

  return (
    <>
      <div className="mt-8 mb-4 system-sm-medium text-text-primary">
        {t(`${prefixEmbedded}.explanation`, { ns: 'appOverview' })}
      </div>
      {supportedHiddenInputs.length > 0 && (
        <div className="mb-6 rounded-xl border-[0.5px] border-components-panel-border bg-background-section">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            onClick={() => setHiddenInputsCollapsed(prev => !prev)}
          >
            <div>
              <div className="system-sm-medium text-text-primary">
                {t(`${prefixEmbedded}.hiddenInputs.title`, { ns: 'appOverview' })}
              </div>
              <div className="mt-1 system-xs-regular text-text-tertiary">
                {t(`${prefixEmbedded}.hiddenInputs.description`, { ns: 'appOverview' })}
              </div>
            </div>
            {hiddenInputsCollapsed
              ? <RiArrowRightSLine className="h-4 w-4 shrink-0 text-text-tertiary" />
              : <RiArrowDownSLine className="h-4 w-4 shrink-0 text-text-tertiary" />}
          </button>
          {!hiddenInputsCollapsed && (
            <div className="max-h-72 space-y-4 overflow-y-auto border-t-[0.5px] border-divider-subtle px-4 py-4">
              <WorkflowHiddenInputFields
                hiddenVariables={supportedHiddenInputs}
                values={hiddenInputValues}
                onValueChange={handleHiddenInputValueChange}
                fieldIdPrefix="embedded-hidden-input"
              />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        {OPTION_KEYS.map((v) => {
          return (
            <button
              type="button"
              key={v}
              aria-label={t(`${prefixEmbedded}.${v}`, { ns: 'appOverview' }) || v}
              className={cn(
                style.option,
                optionIconClassName[v],
                option === v && style.active,
              )}
              onClick={() => {
                setOption(v)
                setCopiedOption(null)
              }}
            >
            </button>
          )
        })}
      </div>
      {option === 'chromePlugin' && (
        <div className="mt-6 w-full">
          <button
            type="button"
            className={cn('inline-flex w-full items-center justify-center gap-2 rounded-lg py-3', 'shrink-0 bg-primary-600 text-white hover:bg-primary-600/75 hover:shadow-sm')}
            onClick={navigateToChromeUrl}
          >
            <div className={`relative h-4 w-4 ${style.pluginInstallIcon}`}></div>
            <div className="font-['Inter'] text-sm leading-tight font-medium text-white">{t(`${prefixEmbedded}.chromePlugin`, { ns: 'appOverview' })}</div>
          </button>
        </div>
      )}
      <div className={cn('inline-flex w-full flex-col items-start justify-start rounded-lg border-[0.5px] border-components-panel-border bg-background-section', 'mt-6')}>
        <div className="inline-flex items-center justify-start gap-2 self-stretch rounded-t-lg bg-background-section-burn py-1 pr-1 pl-3">
          <div className="shrink-0 grow system-sm-medium text-text-secondary">
            {t(`${prefixEmbedded}.${option}`, { ns: 'appOverview' })}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={(
                <ActionButton
                  aria-label={(copiedOption === option
                    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
                    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''}
                  onClick={() => void onClickCopy()}
                >
                  {copiedOption === option && <span aria-hidden="true" className="i-ri-clipboard-fill h-4 w-4" />}
                  {copiedOption !== option && <span aria-hidden="true" className="i-ri-clipboard-line h-4 w-4" />}
                </ActionButton>
              )}
            />
            <TooltipContent>
              {(copiedOption === option
                ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
                : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex max-h-[clamp(180px,calc(100dvh-320px),360px)] w-full items-start justify-start gap-2 overflow-auto p-3">
          <div className="shrink grow basis-0 font-mono text-[13px] leading-tight text-text-secondary">
            <pre className="select-text">
              {option === 'scripts'
                ? scriptsContent
                : (
                    <Suspense fallback={previewFallback}>
                      <AsyncEmbeddedOptionContent
                        option={option}
                        iframeUrlPromise={previewIframeUrlPromise}
                        latestResolvedIframeUrlRef={latestResolvedIframeUrlRef}
                      />
                    </Suspense>
                  )}
            </pre>
          </div>
        </div>
      </div>
    </>
  )
}

const Embedded = ({ siteInfo, isShow, onClose, appBaseUrl, accessToken, hiddenInputs, className }: Props) => {
  const { t } = useTranslation()

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (open)
          return
        onClose()
      }}
    >
      <DialogContent className={cn('flex max-h-[calc(100dvh-2rem)] w-[640px] flex-col overflow-hidden!', className)}>
        <DialogTitle className="shrink-0 title-2xl-semi-bold text-text-primary">
          {t(`${prefixEmbedded}.title`, { ns: 'appOverview' })}
        </DialogTitle>
        <DialogCloseButton />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isShow && (
            <EmbeddedContent
              key={`${appBaseUrl ?? ''}:${accessToken ?? ''}:${JSON.stringify(hiddenInputs ?? [])}`}
              siteInfo={siteInfo}
              appBaseUrl={appBaseUrl ?? ''}
              accessToken={accessToken ?? ''}
              hiddenInputs={hiddenInputs}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default Embedded
