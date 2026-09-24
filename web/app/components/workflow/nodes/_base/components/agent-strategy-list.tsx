import type {
  AgentProviderResponse,
  AgentStrategyEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
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
import { trackEvent } from '@/app/components/base/amplitude'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import Empty from '@/app/components/tools/provider/empty'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n/metadata'
import BlockIcon from '../../../block-icon'
import { IndexBar } from '../../../block-selector/index-bar'
import { BlockSelectorPreviewCardContent } from '../../../block-selector/preview-card'
import { ViewType } from '../../../block-selector/types'
import { compareProviderLetters, getProviderLetter } from '../../../block-selector/utils'
import { BlockEnum } from '../../../types'

type StrategyPreview = {
  provider: AgentProviderResponse
  strategy: AgentStrategyEntity
}
type OnSelectStrategy = (provider: AgentProviderResponse, strategy: AgentStrategyEntity) => void

function StrategyAction({
  provider,
  strategy,
  previewCardHandle,
  onSelect,
}: StrategyPreview & {
  previewCardHandle: PreviewCardHandle<StrategyPreview>
  onSelect: OnSelectStrategy
}) {
  const language = useGetLanguage()
  const descriptionId = useId()
  const description = renderI18nObject(strategy.description, language)
  return (
    <>
      <PreviewCardTrigger
        delay={150}
        closeDelay={150}
        handle={previewCardHandle}
        payload={{ provider, strategy }}
        render={
          <Button
            variant="ghost"
            size="medium"
            aria-describedby={description ? descriptionId : undefined}
            className="w-full justify-between pr-1 pl-5.25 text-left focus-visible:ring-inset"
            onClick={() => {
              onSelect(provider, strategy)
              trackEvent('tool_selected', {
                tool_name: strategy.identity.name,
                plugin_id: provider.plugin_id,
              })
            }}
          >
            <div className="truncate border-l-2 border-divider-subtle py-2 pl-4 system-sm-medium text-text-secondary">
              {renderI18nObject(strategy.identity.label, language)}
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

function StrategyProvider({
  provider,
  previewCardHandle,
  onSelect,
}: {
  provider: AgentProviderResponse
  previewCardHandle: PreviewCardHandle<StrategyPreview>
  onSelect: OnSelectStrategy
}) {
  const language = useGetLanguage()
  const { getIconUrl } = useGetIcon()
  const panelId = useId()
  return (
    <Collapsible className="mb-1 last-of-type:mb-0">
      <div className="group/item relative flex w-full items-center rounded-lg">
        <CollapsibleTrigger
          aria-controls={panelId}
          className="group/collapsible flex h-8 min-h-8 w-full min-w-0 touch-manipulation items-center justify-start gap-0 rounded-lg bg-transparent pr-2 pl-3 text-start system-sm-medium text-text-secondary outline-hidden select-none group-hover/item:bg-state-base-hover hover:bg-state-base-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset data-panel-open:text-text-primary"
        >
          <BlockIcon
            className="shrink-0"
            type={BlockEnum.Tool}
            toolIcon={
              provider.declaration.identity.icon
                ? getIconUrl(provider.declaration.identity.icon)
                : ''
            }
          />
          <div className="ml-2 flex w-0 grow items-center text-sm text-text-primary">
            <span className="max-w-62.5 truncate">
              {renderI18nObject(provider.declaration.identity.label, language)}
            </span>
          </div>
          <span
            aria-hidden
            className="ml-2 i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary transition-transform group-data-panel-open/collapsible:rotate-90 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel id={panelId}>
        {provider.declaration.strategies?.map((strategy) => (
          <StrategyAction
            key={strategy.identity.name}
            provider={provider}
            strategy={strategy}
            previewCardHandle={previewCardHandle}
            onSelect={onSelect}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function AgentStrategyList({
  providers,
  viewType,
  onSelect,
  className,
}: {
  providers: AgentProviderResponse[]
  viewType: ViewType
  onSelect: OnSelectStrategy
  className?: string
}) {
  const language = useGetLanguage()
  const { getIconUrl } = useGetIcon()
  const [previewCardHandle] = useState(() => createPreviewCardHandle<StrategyPreview>())
  const itemRefsRef = useRef<Record<string, HTMLDivElement | null>>({})
  const { letters, flatGroups, authorGroups } = useMemo(() => {
    const buckets = new Map<string, Map<string, AgentProviderResponse[]>>()
    for (const provider of providers) {
      const identity = provider.declaration.identity
      const label = renderI18nObject(identity.label, language) || identity.name
      const letter = getProviderLetter(label[0] || '#')
      const bucket = buckets.get(letter) ?? new Map<string, AgentProviderResponse[]>()
      const group = bucket.get(identity.author) ?? []
      group.push(provider)
      bucket.set(identity.author, group)
      buckets.set(letter, bucket)
    }
    const sortedBuckets = [...buckets].sort(([left], [right]) =>
      compareProviderLetters(left, right),
    )
    const authorGroups = new Map<string, AgentProviderResponse[]>()
    for (const bucket of buckets.values()) {
      for (const [author, providers] of bucket) {
        const group = authorGroups.get(author) ?? []
        group.push(...providers)
        authorGroups.set(author, group)
      }
    }
    return {
      letters: sortedBuckets.map(([letter]) => letter),
      flatGroups: sortedBuckets.map(([letter, groups]) => ({
        letter,
        providers: [...groups.values()].flat(),
      })),
      authorGroups: [...authorGroups],
    }
  }, [providers, language])

  return (
    <div className={cn('max-w-full p-1', className)}>
      {!providers.length && (
        <div className="py-10">
          <Empty isAgent />
        </div>
      )}
      {viewType === ViewType.flat ? (
        <div className="flex w-full min-w-0">
          <div className="mr-1 min-w-0 grow">
            {flatGroups.flatMap(({ letter, providers }) =>
              providers.map((provider, index) => (
                <div
                  key={provider.declaration.identity.name}
                  ref={(element) => {
                    if (index === 0) itemRefsRef.current[letter] = element
                  }}
                >
                  <StrategyProvider
                    provider={provider}
                    previewCardHandle={previewCardHandle}
                    onSelect={onSelect}
                  />
                </div>
              )),
            )}
          </div>
          {providers.length > 10 && (
            <IndexBar letters={letters} itemRefs={itemRefsRef} className="top-0 xl:top-36" />
          )}
        </div>
      ) : (
        <div>
          {authorGroups.map(([author, providers]) => (
            <div key={author}>
              <div className="flex h-5.5 items-center px-3 text-xs font-medium text-text-tertiary">
                {author}
              </div>
              {providers.map((provider) => (
                <StrategyProvider
                  key={provider.declaration.identity.name}
                  provider={provider}
                  previewCardHandle={previewCardHandle}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) =>
          payload && (
            <BlockSelectorPreviewCardContent>
              <BlockIcon
                size="md"
                className="mb-2"
                type={BlockEnum.Tool}
                toolIcon={
                  payload.provider.declaration.identity.icon
                    ? getIconUrl(payload.provider.declaration.identity.icon)
                    : ''
                }
              />
              <div className="mb-1 text-sm/5 wrap-break-word text-text-primary">
                {renderI18nObject(payload.strategy.identity.label, language)}
              </div>
              <div className="text-xs leading-4.5 wrap-break-word text-text-secondary">
                {renderI18nObject(payload.strategy.description, language)}
              </div>
            </BlockSelectorPreviewCardContent>
          )
        }
      </PreviewCard>
    </div>
  )
}
