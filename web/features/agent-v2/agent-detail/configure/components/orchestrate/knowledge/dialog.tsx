'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type KnowledgeRetrievalQueryMode = 'agent' | 'custom'
type KnowledgeRetrievalMetadataMode = 'manual' | 'disabled' | 'automatic'

const queryModeOptions: KnowledgeRetrievalQueryMode[] = ['agent', 'custom']
const metadataModeOptions: KnowledgeRetrievalMetadataMode[] = ['manual', 'disabled', 'automatic']

const optionCardClassName = cn(
  'flex h-8 flex-1 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-center system-sm-regular text-text-secondary transition-colors',
  'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
  'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
  'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:font-medium data-checked:text-text-primary data-checked:shadow-xs data-checked:shadow-shadow-shadow-3',
)

function KnowledgeRetrievalDialogIcon() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-1 text-text-primary-on-surface shadow-md shadow-shadow-shadow-5">
      <span aria-hidden className="i-ri-book-open-line size-4" />
    </span>
  )
}

function DialogFormLabel({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <div id={id} className="flex min-h-6 items-center system-sm-semibold-uppercase text-text-secondary">
      {children}
    </div>
  )
}

export function AgentKnowledgeRetrievalDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const [name, setName] = useState(() => t('agentDetail.configure.knowledgeRetrieval.retrievalOne'))
  const [queryMode, setQueryMode] = useState<KnowledgeRetrievalQueryMode>('agent')
  const [metadataMode, setMetadataMode] = useState<KnowledgeRetrievalMetadataMode>('manual')
  const queryModeLabelId = 'agent-knowledge-retrieval-query-mode-label'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[520px] max-h-[calc(100dvh-2rem)] w-[400px] flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {t('agentDetail.configure.knowledgeRetrieval.dialog.title')}
        </DialogTitle>
        <div className="flex items-center gap-2 px-4 pt-3">
          <KnowledgeRetrievalDialogIcon />
          <Input
            aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.nameLabel')}
            className="h-7 min-w-0 flex-1 rounded-md px-1 py-0 system-xl-semibold text-text-primary"
            value={name}
            onChange={event => setName(event.currentTarget.value)}
          />
          <DialogCloseButton className="static size-7 shrink-0 rounded-md" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
          <div className="flex flex-col gap-1 px-4 py-2">
            <DialogFormLabel id={queryModeLabelId}>
              {t('agentDetail.configure.knowledgeRetrieval.dialog.query.label')}
            </DialogFormLabel>
            <RadioGroup<KnowledgeRetrievalQueryMode>
              aria-labelledby={queryModeLabelId}
              className="w-full gap-2"
              value={queryMode}
              onValueChange={(nextMode) => {
                if (nextMode)
                  setQueryMode(nextMode)
              }}
            >
              {queryModeOptions.map(mode => (
                <RadioRoot
                  key={mode}
                  value={mode}
                  variant="unstyled"
                  nativeButton
                  render={<button type="button" className={optionCardClassName} />}
                >
                  <span className="min-w-0 truncate">
                    {t(`agentDetail.configure.knowledgeRetrieval.dialog.query.${mode}`)}
                  </span>
                </RadioRoot>
              ))}
            </RadioGroup>
            <p className="pt-1 system-xs-regular text-text-tertiary">
              {t(`agentDetail.configure.knowledgeRetrieval.dialog.query.${queryMode}Description`)}
            </p>
          </div>

          <div className="flex flex-col gap-1 px-4 py-2">
            <div className="flex items-center gap-2">
              <DialogFormLabel>
                {t('agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label')}
              </DialogFormLabel>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  disabled
                  className="h-6 gap-1 px-1.5"
                >
                  <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
                  <span className="px-0.5 system-xs-medium">
                    {t('agentDetail.configure.knowledgeRetrieval.dialog.knowledge.retrievalSetting')}
                  </span>
                </Button>
                <span aria-hidden className="h-3 w-px bg-divider-regular" />
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.knowledge.add')}
                  className="size-6 px-0"
                >
                  <span aria-hidden className="i-ri-add-line size-4" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-10 items-center justify-center rounded-[10px] bg-background-section p-3 text-center system-xs-regular text-text-tertiary">
              {t('agentDetail.configure.knowledgeRetrieval.dialog.knowledge.empty')}
            </div>
          </div>

          <div className="flex items-center gap-1 px-4 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <DialogFormLabel>
                {t('agentDetail.configure.knowledgeRetrieval.dialog.metadata.label')}
              </DialogFormLabel>
              <span aria-hidden className="i-ri-question-line size-3.5 shrink-0 text-text-quaternary" />
            </div>
            <Select
              value={metadataMode}
              onValueChange={(nextMode) => {
                if (nextMode)
                  setMetadataMode(nextMode as KnowledgeRetrievalMetadataMode)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.metadata.modeLabel')}
                size="small"
                className="w-fit border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs"
              >
                {t(`agentDetail.configure.knowledgeRetrieval.dialog.metadata.${metadataMode}`)}
              </SelectTrigger>
              <SelectContent popupClassName="min-w-30">
                {metadataModeOptions.map(mode => (
                  <SelectItem key={mode} value={mode}>
                    <SelectItemText>
                      {t(`agentDetail.configure.knowledgeRetrieval.dialog.metadata.${mode}`)}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" size="small" className="h-6 gap-1 px-1.5">
              <span aria-hidden className="i-ri-filter-3-line size-3.5" />
              <span className="system-xs-medium">
                {t('agentDetail.configure.knowledgeRetrieval.dialog.metadata.conditions')}
              </span>
              <span className="flex min-w-4 items-center justify-center rounded-[5px] border border-text-accent-secondary px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
                2
              </span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4">
          <div aria-hidden className="h-2 w-8 border-b border-divider-regular" />
          <a
            href="https://docs.dify.ai/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary hover:text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-book-read-line size-3 shrink-0" />
            <span className="min-w-0 truncate">
              {t('agentDetail.configure.knowledgeRetrieval.dialog.learnMore')}
            </span>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
