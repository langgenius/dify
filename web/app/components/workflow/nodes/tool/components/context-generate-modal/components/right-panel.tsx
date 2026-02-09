import type { PointerEvent, RefObject } from 'react'
import type { ContextGenerateResponse } from '@/service/debug'
import { RiArrowDownSLine, RiCheckLine, RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import { CodeAssistant } from '@/app/components/base/icons/src/vender/line/general'
import Loading from '@/app/components/base/loading'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { cn } from '@/utils/classnames'

type VersionOption = {
  index: number
  label: string
}

type DisplayOutputData = {
  variables: ContextGenerateResponse['variables']
  outputs: ContextGenerateResponse['outputs']
}

type RightPanelProps = {
  isInitView: boolean
  isGenerating: boolean
  displayVersion: ContextGenerateResponse | null
  displayCodeLanguage: CodeLanguage
  displayOutputData: DisplayOutputData | null
  rightContainerRef: RefObject<HTMLDivElement | null>
  resolvedCodePanelHeight: number
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void
  versionOptions: VersionOption[]
  currentVersionIndex: number
  currentVersionLabel: string
  onSelectVersion: (index: number) => void
  onRun: () => void
  onApply: () => void
  canRun: boolean
  canApply: boolean
  isRunning: boolean
  onClose: () => void
}

const RightPanel = ({
  isInitView,
  isGenerating,
  displayVersion,
  displayCodeLanguage,
  displayOutputData,
  rightContainerRef,
  resolvedCodePanelHeight,
  onResizeStart,
  versionOptions,
  currentVersionIndex,
  currentVersionLabel,
  onSelectVersion,
  onRun,
  onApply,
  canRun,
  canApply,
  isRunning,
  onClose,
}: RightPanelProps) => {
  const { t } = useTranslation()
  const rightPlaceholderLines = useMemo(() => {
    const placeholder = t('nodes.tool.contextGenerate.rightSidePlaceholder', { ns: 'workflow' })
    return String(placeholder).split('\n').filter(Boolean)
  }, [t])

  const [isVersionMenuOpen, setVersionMenuOpen] = useState(false)
  const handleVersionMenuOpen = useCallback((open: boolean) => {
    if (versionOptions.length > 1)
      setVersionMenuOpen(open)
    else
      setVersionMenuOpen(false)
  }, [versionOptions.length])

  const handleVersionMenuToggle = useCallback(() => {
    if (versionOptions.length > 1)
      setVersionMenuOpen(value => !value)
  }, [versionOptions.length])

  const codeLanguageLabel = displayCodeLanguage === CodeLanguage.javascript
    ? t('nodes.tool.contextGenerate.codeLanguage.javascript', { ns: 'workflow' })
    : t('nodes.tool.contextGenerate.codeLanguage.python3', { ns: 'workflow' })

  const emptyPanelClassName = cn(
    'flex h-full flex-col',
    isInitView
      ? 'rounded-l-xl bg-components-panel-bg pb-1 pl-1'
      : 'rounded-[10px] bg-components-panel-bg',
  )

  return (
    <div
      className={cn(
        'flex h-full w-0 grow flex-col bg-background-body',
        isInitView ? 'py-1' : 'pt-1',
      )}
    >
      {isInitView && (
        <div className="flex h-10 items-center justify-end px-3 py-1">
          <ActionButton size="m" className="!h-8 !w-8" onClick={onClose}>
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </ActionButton>
        </div>
      )}
      {!isInitView && (
        <div className="flex shrink-0 items-center justify-between px-3 py-2">
          <div className="flex flex-col gap-1">
            <div className="text-[13px] font-semibold uppercase text-text-secondary">
              {t('nodes.tool.contextGenerate.generatedCode', { ns: 'workflow' })}
            </div>
            <PortalToFollowElem
              placement="bottom-start"
              offset={{
                mainAxis: 6,
                crossAxis: -4,
              }}
              open={isVersionMenuOpen}
              onOpenChange={handleVersionMenuOpen}
            >
              <PortalToFollowElemTrigger asChild onClick={handleVersionMenuToggle}>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 text-xs font-medium text-text-tertiary',
                    versionOptions.length > 1 ? 'cursor-pointer' : 'cursor-default',
                  )}
                >
                  <span>{currentVersionLabel}</span>
                  {versionOptions.length > 1 && <RiArrowDownSLine className="h-3.5 w-3.5" />}
                </button>
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent className="z-[1010]">
                <div className="w-[208px] rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
                  <div className="system-xs-medium-uppercase flex h-[22px] items-center px-3 text-text-tertiary">
                    {t('generate.versions', { ns: 'appDebug' })}
                  </div>
                  {versionOptions.map(option => (
                    <button
                      key={option.index}
                      type="button"
                      className={cn(
                        'flex h-7 w-full items-center rounded-lg px-2 text-[13px] text-text-secondary',
                        option.index === currentVersionIndex
                          ? 'bg-state-base-hover'
                          : 'hover:bg-state-base-hover',
                      )}
                      onClick={() => {
                        onSelectVersion(option.index)
                        setVersionMenuOpen(false)
                      }}
                    >
                      <span className="flex-1 truncate text-left">{option.label}</span>
                      {option.index === currentVersionIndex && (
                        <RiCheckLine className="h-4 w-4 text-text-accent" />
                      )}
                    </button>
                  ))}
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>
          </div>
          <div className="flex items-center gap-2">
            {isRunning
              ? (
                  <div className="flex h-8 items-center gap-2 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg px-3 text-xs font-medium text-text-secondary">
                    <span className="h-2 w-2 rounded-full bg-util-colors-blue-blue-500" />
                    {t('nodes.tool.contextGenerate.running', { ns: 'workflow' })}
                  </div>
                )
              : (
                  <Button
                    size="small"
                    onClick={onRun}
                    disabled={!canRun || isGenerating}
                  >
                    {t('nodes.tool.contextGenerate.run', { ns: 'workflow' })}
                  </Button>
                )}
            <Button
              variant="primary"
              size="small"
              onClick={onApply}
              disabled={!canApply || isGenerating}
            >
              {t('nodes.tool.contextGenerate.apply', { ns: 'workflow' })}
            </Button>
            <div className="mx-1 h-4 w-px bg-divider-regular" />
            <ActionButton size="m" className="!h-8 !w-8" onClick={onClose}>
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </ActionButton>
          </div>
        </div>
      )}
      <div
        ref={rightContainerRef}
        className={cn(
          'flex h-full flex-col overflow-hidden',
          isInitView ? 'px-0 pb-0' : 'px-3 pb-3',
        )}
      >
        {isGenerating && !displayVersion && (
          <div className={cn(emptyPanelClassName, 'items-center justify-center')}>
            <Loading />
            <div className="mt-3 text-[13px] text-text-tertiary">
              {t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}
            </div>
          </div>
        )}
        {!isGenerating && !displayVersion && (
          <div className={emptyPanelClassName}>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-20 text-center">
              <CodeAssistant className="h-8 w-8 text-divider-regular" />
              <div className="text-xs leading-4 text-text-quaternary">
                {rightPlaceholderLines.map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
              </div>
            </div>
          </div>
        )}
        {displayVersion && (
          <div className="flex h-full flex-col overflow-hidden">
            <div
              className="flex min-h-[80px] flex-col overflow-hidden rounded-[10px] bg-components-input-bg-normal"
              style={{ height: resolvedCodePanelHeight }}
            >
              <div className="flex items-center border-b border-divider-subtle px-2 py-1">
                <div className="flex flex-1 items-center px-1 py-0.5">
                  <span className="text-xs font-semibold uppercase text-text-secondary">
                    {codeLanguageLabel}
                  </span>
                </div>
                <CopyFeedbackNew content={displayVersion.code || ''} className="!h-6 !w-6" />
              </div>
              <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">
                <CodeEditor
                  noWrapper
                  isExpand
                  readOnly
                  language={displayCodeLanguage}
                  value={displayVersion.code || ''}
                  className="h-full"
                />
              </div>
            </div>
            <button
              type="button"
              className="flex h-4 w-full cursor-row-resize items-center px-2"
              aria-label={t('nodes.tool.contextGenerate.resizeHandle', { ns: 'workflow' })}
              onPointerDown={onResizeStart}
            >
              <div className="h-[2px] w-full rounded-full bg-divider-subtle" />
            </button>
            <div className="flex min-h-[80px] flex-1 flex-col overflow-hidden rounded-[10px] bg-components-input-bg-normal">
              <div className="flex items-center border-b border-divider-subtle px-2 py-1">
                <div className="flex flex-1 items-center px-1 py-0.5">
                  <span className="text-xs font-semibold uppercase text-text-secondary">
                    {t('nodes.tool.contextGenerate.output', { ns: 'workflow' })}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">
                <CodeEditor
                  noWrapper
                  isExpand
                  readOnly
                  isJSONStringifyBeauty
                  language={CodeLanguage.json}
                  value={displayOutputData ?? { variables: [], outputs: {} }}
                  className="h-full"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RightPanel
