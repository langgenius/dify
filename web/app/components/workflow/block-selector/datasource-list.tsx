import type {
  DatasourceEntity,
  RagPipelineDatasourceProviderResponse,
} from '@dify/contracts/api/console/rag/types.gen'
import type { PreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { useId, useMemo, useRef, useState } from 'react'
import { resolveDatasourceIcon } from '@/app/components/rag-pipeline/utils/datasource-icon'
import Empty from '@/app/components/tools/provider/empty'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n/metadata'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { IndexBar } from './index-bar'
import { BlockSelectorPreviewCardContent } from './preview-card'
import { compareProviderLetters, getProviderLetter } from './utils'

type DatasourcePreview = { icon: string; label: string; description: string }
type OnSelectDatasource = (
  provider: RagPipelineDatasourceProviderResponse,
  datasource: DatasourceEntity,
) => void

function DatasourceAction({
  provider,
  datasource,
  previewCardHandle,
  onSelect,
}: {
  provider: RagPipelineDatasourceProviderResponse
  datasource: DatasourceEntity
  previewCardHandle: PreviewCardHandle<DatasourcePreview>
  onSelect: OnSelectDatasource
}) {
  const language = useGetLanguage()
  const descriptionId = useId()
  const label = renderI18nObject(datasource.identity.label, language)
  const description = renderI18nObject(datasource.description, language)
  return (
    <>
      <PreviewCardTrigger
        delay={150}
        closeDelay={150}
        handle={previewCardHandle}
        payload={{
          icon: resolveDatasourceIcon(provider.declaration.identity.icon),
          label,
          description,
        }}
        render={
          <Button
            variant="ghost"
            size="medium"
            aria-describedby={description ? descriptionId : undefined}
            className="w-full justify-between pr-1 pl-5.25 text-left focus-visible:ring-inset disabled:cursor-default"
            onClick={() => onSelect(provider, datasource)}
          >
            <div className="truncate border-l-2 border-divider-subtle py-2 pl-4 system-sm-medium text-text-secondary">
              <span>{label}</span>
            </div>
          </Button>
        }
      />
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
    </>
  )
}

function DatasourceGroup({
  provider,
  hasSearchText,
  previewCardHandle,
  onSelect,
}: {
  provider: RagPipelineDatasourceProviderResponse
  hasSearchText: boolean
  previewCardHandle: PreviewCardHandle<DatasourcePreview>
  onSelect: OnSelectDatasource
}) {
  const language = useGetLanguage()
  const panelId = useId()
  const [open, setOpen] = useState(hasSearchText)
  const [previousHasSearchText, setPreviousHasSearchText] = useState(hasSearchText)
  if (previousHasSearchText !== hasSearchText) {
    setPreviousHasSearchText(hasSearchText)
    setOpen(hasSearchText)
  }
  return (
    <Collapsible className="mb-1 last-of-type:mb-0" open={open} onOpenChange={setOpen}>
      <div className="group/item relative flex w-full items-center rounded-lg">
        <CollapsibleTrigger
          aria-controls={panelId}
          className="group/collapsible flex h-8 min-h-8 w-full min-w-0 touch-manipulation items-center justify-start gap-0 rounded-lg bg-transparent pr-2 pl-3 text-start system-sm-medium text-text-secondary outline-hidden select-none group-hover/item:bg-state-base-hover hover:bg-state-base-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset data-panel-open:text-text-primary"
        >
          <div className="flex h-8 min-w-0 grow items-center">
            <BlockIcon
              className="shrink-0"
              type={BlockEnum.DataSource}
              toolIcon={resolveDatasourceIcon(provider.declaration.identity.icon)}
            />
            <div className="ml-2 flex w-0 grow items-center text-sm text-text-primary">
              <span className="max-w-62.5 truncate">
                {renderI18nObject(provider.declaration.identity.label, language)}
              </span>
            </div>
          </div>
          <span
            aria-hidden
            className="ml-2 i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary transition-transform group-data-panel-open/collapsible:rotate-90 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel id={panelId}>
        {provider.declaration.datasources?.map((datasource) => (
          <DatasourceAction
            key={datasource.identity.name}
            provider={provider}
            datasource={datasource}
            previewCardHandle={previewCardHandle}
            onSelect={onSelect}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function DatasourceList({
  providers,
  hasSearchText,
  onSelect,
  className,
}: {
  providers: RagPipelineDatasourceProviderResponse[]
  hasSearchText: boolean
  onSelect: OnSelectDatasource
  className?: string
}) {
  const language = useGetLanguage()
  const [previewCardHandle] = useState(() => createPreviewCardHandle<DatasourcePreview>())
  const itemRefsRef = useRef<Record<string, HTMLDivElement | null>>({})
  const groups = useMemo(() => {
    const buckets = new Map<string, RagPipelineDatasourceProviderResponse[]>()
    for (const provider of providers) {
      const label =
        renderI18nObject(provider.declaration.identity.label, language) || provider.provider
      const letter = getProviderLetter(label[0] ?? '#')
      const bucket = buckets.get(letter) ?? []
      bucket.push(provider)
      buckets.set(letter, bucket)
    }
    return [...buckets.entries()].sort(([left], [right]) => compareProviderLetters(left, right))
  }, [providers, language])

  return (
    <div className={cn('max-w-full p-1', className)}>
      {!providers.length && !hasSearchText && (
        <div className="py-10">
          <Empty />
        </div>
      )}
      <div className="flex w-full min-w-0">
        <div className="mr-1 min-w-0 grow">
          {groups.flatMap(([letter, group]) =>
            group.map((provider, index) => (
              <div
                key={`${provider.plugin_id}/${provider.provider}`}
                ref={(element) => {
                  if (index === 0) itemRefsRef.current[letter] = element
                }}
              >
                <DatasourceGroup
                  provider={provider}
                  hasSearchText={hasSearchText}
                  onSelect={onSelect}
                  previewCardHandle={previewCardHandle}
                />
              </div>
            )),
          )}
        </div>
        {providers.length > 10 && (
          <IndexBar letters={groups.map(([letter]) => letter)} itemRefs={itemRefsRef} />
        )}
      </div>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) =>
          payload && (
            <BlockSelectorPreviewCardContent>
              <BlockIcon
                size="md"
                className="mb-2"
                type={BlockEnum.DataSource}
                toolIcon={payload.icon}
              />
              <div className="mb-1 text-sm/5 wrap-break-word text-text-primary">
                {payload.label}
              </div>
              <div className="text-xs leading-4.5 wrap-break-word text-text-secondary">
                {payload.description}
              </div>
            </BlockSelectorPreviewCardContent>
          )
        }
      </PreviewCard>
    </div>
  )
}
