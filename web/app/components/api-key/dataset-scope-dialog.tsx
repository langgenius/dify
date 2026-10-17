'use client'

import type { DialogContentProps, DialogProps } from '@langgenius/dify-ui/dialog'
import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { knowledgeFsEnabledAtom } from '@/features/knowledge-fs-availability/state'
import { consoleQuery } from '@/service/console'

type Scope = 'all' | 'specific'
// Legacy knowledge bases (datasets) and KnowledgeFS spaces live in different tables, so
// a selection keeps track of which kind each entry is and reports the ids separately.
type KnowledgeBaseKind = 'dataset' | 'knowledge_space'
type SelectedKb = { id: string; name: string; kind: KnowledgeBaseKind }

export type DatasetApiKeyScopeSelection = {
  datasetIds: string[]
  knowledgeSpaceIds: string[]
}

const PICKER_PAGE_SIZE = 20

type DatasetScopeDialogProps = Required<Pick<DialogProps, 'open' | 'onOpenChange'>> &
  Pick<DialogContentProps, 'finalFocus'> & {
    isCreating: boolean
    createDisabled: boolean
    // Emits the knowledge-base ids to scope the new key to, split by kind. Both lists empty
    // means the key can access every knowledge base in the workspace (the "all" scope).
    onConfirm: (selection: DatasetApiKeyScopeSelection) => void
  }

export function DatasetScopeDialog({
  open,
  finalFocus,
  onOpenChange,
  ...props
}: DatasetScopeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && props.isCreating) details.cancel()
        else onOpenChange(nextOpen, details)
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
        className="w-140"
      >
        <DatasetScopeContent {...props} />
      </DialogContent>
    </Dialog>
  )
}

type PickerPageQuery = Pick<
  UseInfiniteQueryResult,
  | 'fetchNextPage'
  | 'hasNextPage'
  | 'isError'
  | 'isFetchNextPageError'
  | 'isFetchingNextPage'
  | 'isRefetching'
  | 'refetch'
>

// Each picker source pages independently: a failed source shows its own retry, and a source with
// more matches offers the next page so every match stays selectable.
function PickerPagination({
  query,
  errorLabel,
  loadMoreLabel,
  onSettled,
}: {
  query: PickerPageQuery
  errorLabel: string
  loadMoreLabel: string
  // Returns focus to the picker input once the pagination control may have unmounted.
  onSettled: () => void
}) {
  const { t } = useTranslation(['common'])

  if (query.isError) {
    const retry = async () => {
      await (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
      onSettled()
    }
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-2 px-3 py-2 system-xs-regular text-text-destructive"
      >
        <span className="min-w-0">{errorLabel}</span>
        <Button
          size="small"
          className="shrink-0"
          loading={query.isRefetching || query.isFetchingNextPage}
          onClick={() => void retry()}
        >
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </div>
    )
  }

  if (!query.hasNextPage) return null

  return (
    <div className="px-1 pb-1">
      <Button
        variant="ghost"
        size="small"
        className="w-full"
        loading={query.isFetchingNextPage}
        disabled={query.isFetchingNextPage}
        onClick={async () => {
          await query.fetchNextPage()
          onSettled()
        }}
      >
        {loadMoreLabel}
      </Button>
    </div>
  )
}

function DatasetScopeContent({
  isCreating,
  createDisabled,
  onConfirm,
}: Omit<DatasetScopeDialogProps, 'open' | 'finalFocus' | 'onOpenChange'>) {
  const { t } = useTranslation(['appApi', 'common'])
  const scopeId = useId()
  const knowledgeFsEnabled = useAtomValue(knowledgeFsEnabledAtom)
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SelectedKb[]>([])
  const [keyword, setKeyword] = useState('')
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const focusPickerInput = () => pickerInputRef.current?.focus()

  const datasetsQuery = useInfiniteQuery(
    consoleQuery.datasets.get.infiniteOptions({
      input: (page: number) => ({ query: { page, ...(keyword ? { keyword } : {}) } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
      enabled: scope === 'specific',
      staleTime: 0,
      refetchOnMount: 'always',
    }),
  )
  const datasets = useMemo<SelectedKb[]>(
    () =>
      (datasetsQuery.data?.pages ?? []).flatMap((page) =>
        page.data.map(({ id, name }) => ({ id, name, kind: 'dataset' })),
      ),
    [datasetsQuery.data],
  )
  // KnowledgeFS spaces come from their own list endpoint, which only exists when the
  // workspace has KnowledgeFS enabled.
  const knowledgeSpacesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PICKER_PAGE_SIZE,
          page: pageParam,
          ...(keyword ? { query: keyword } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
    enabled: scope === 'specific' && knowledgeFsEnabled,
  })
  const knowledgeSpaces = useMemo<SelectedKb[]>(
    () =>
      (knowledgeSpacesQuery.data?.pages ?? [])
        .flatMap((page) => page.data)
        .map((space) => ({
          kind: 'knowledge_space',
          id: space.control_space_id,
          name: space.technical_summary?.name ?? space.control_space_id,
        })),
    [knowledgeSpacesQuery.data],
  )
  const pickerItems = useMemo(() => [...knowledgeSpaces, ...datasets], [knowledgeSpaces, datasets])
  const isLoading =
    datasetsQuery.isLoading || (knowledgeFsEnabled && knowledgeSpacesQuery.isLoading)
  // "No data" is only true once every enabled lookup succeeded; a failed lookup gets its own
  // error state so it is not mistaken for an empty search.
  const hasLookupError =
    datasetsQuery.isError || (knowledgeFsEnabled && knowledgeSpacesQuery.isError)
  const selectedIds = useMemo(() => new Set(selected.map((kb) => kb.id)), [selected])
  const addLabel = t(($) => $['apiKeyModal.addKnowledgeBase'], { ns: 'appApi' })
  const searchLabel = t(($) => $['apiKeyModal.searchKnowledgeBases'], { ns: 'appApi' })

  const removeKb = (id: string) => setSelected((prev) => prev.filter((kb) => kb.id !== id))

  const canCreate = !createDisabled && (scope === 'all' || selected.length > 0)

  const handleConfirm = () => {
    if (!canCreate || isCreating) return
    if (scope !== 'specific') {
      onConfirm({ datasetIds: [], knowledgeSpaceIds: [] })
      return
    }
    onConfirm({
      datasetIds: selected.filter((kb) => kb.kind === 'dataset').map((kb) => kb.id),
      knowledgeSpaceIds: selected.filter((kb) => kb.kind === 'knowledge_space').map((kb) => kb.id),
    })
  }

  const renderPickerOption = (kb: SelectedKb) => (
    <ComboboxItem<SelectedKb> key={kb.id} value={kb} className="grid-cols-[auto_1fr]">
      {/* Visual only: the option owns the click target and the selected state. */}
      <span aria-hidden inert className="flex">
        <Checkbox checked={selectedIds.has(kb.id)} />
      </span>
      <span className="min-w-0 truncate system-sm-regular text-text-secondary">{kb.name}</span>
    </ComboboxItem>
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleConfirm()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['apiKeyModal.addTitle'], { ns: 'appApi' })}</DialogTitle>
        <DialogDescription>
          {t(($) => $['apiKeyModal.addSubtitle'], { ns: 'appApi' })}
        </DialogDescription>
        <DialogCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={isCreating}
        />
      </DialogHeader>

      <DialogBody className="flex flex-col gap-3">
        <div id={scopeId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['apiKeyModal.knowledgeBaseAccess'], { ns: 'appApi' })}
        </div>
        <RadioGroup<Scope>
          name="knowledgeBaseScope"
          aria-labelledby={scopeId}
          disabled={isCreating}
          value={scope}
          onValueChange={setScope}
        >
          <div className="flex flex-col gap-3">
            <label htmlFor={`${scopeId}-all`} className="flex cursor-pointer items-start gap-2">
              <Radio id={`${scopeId}-all`} value="all" className="mt-0.5" />
              <div className="flex flex-col">
                <span className="system-sm-medium text-text-secondary">
                  {t(($) => $['apiKeyModal.scopeAllDatasets'], { ns: 'appApi' })}
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['apiKeyModal.scopeAllDatasetsTip'], { ns: 'appApi' })}
                </span>
              </div>
            </label>
            <label
              htmlFor={`${scopeId}-specific`}
              className="flex cursor-pointer items-start gap-2"
            >
              <Radio id={`${scopeId}-specific`} value="specific" className="mt-0.5" />
              <div className="flex flex-col">
                <span className="system-sm-medium text-text-secondary">
                  {t(($) => $['apiKeyModal.scopeSpecificDatasets'], { ns: 'appApi' })}
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['apiKeyModal.scopeSpecificDatasetsTip'], { ns: 'appApi' })}
                </span>
              </div>
            </label>
          </div>
        </RadioGroup>

        {scope === 'specific' && (
          <div className="flex flex-col gap-2">
            <div className="system-sm-semibold text-text-secondary">
              {t(($) => $['apiKeyModal.selectedKnowledgeBases'], { ns: 'appApi' })}
            </div>
            <div className="flex flex-col gap-2 rounded-lg border-[0.5px] border-divider-subtle bg-components-panel-bg p-3">
              {selected.length === 0 ? (
                <div className="py-0.5 system-xs-regular text-text-tertiary">
                  {t(($) => $['apiKeyModal.noKnowledgeBasesSelected'], { ns: 'appApi' })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="system-xs-regular text-text-tertiary">
                    {t(($) => $['apiKeyModal.selectedKnowledgeBasesCount'], {
                      ns: 'appApi',
                      count: selected.length,
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.map((kb) => (
                      <div
                        key={kb.id}
                        className="flex items-center gap-1 rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg px-2 py-1"
                      >
                        <span className="max-w-40 truncate system-xs-medium text-text-secondary">
                          {kb.name}
                        </span>
                        {kb.kind === 'knowledge_space' && (
                          <span className="shrink-0 rounded-sm bg-components-badge-bg-gray-soft px-1 system-2xs-medium-uppercase text-text-tertiary">
                            {t(($) => $['apiKeyModal.knowledgeSpaceBadge'], { ns: 'appApi' })}
                          </span>
                        )}
                        <IconButton
                          size="xs"
                          disabled={isCreating}
                          aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${kb.name}`}
                          className="shrink-0"
                          onClick={() => removeKb(kb.id)}
                        >
                          <span aria-hidden className="i-ri-close-line size-3.5" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Combobox<SelectedKb, true>
                multiple
                disabled={isCreating}
                items={pickerItems}
                filter={null}
                value={selected}
                inputValue={keyword}
                itemToStringLabel={(kb) => kb.name}
                isItemEqualToValue={(item, value) => item.id === value.id}
                onValueChange={setSelected}
                onInputValueChange={(value, details) => {
                  // Keep the query so several results of one search can be picked.
                  if (details.isItemPress) details.cancel()
                  else setKeyword(value)
                }}
              >
                <ComboboxTrigger
                  aria-label={addLabel}
                  render={
                    <Button
                      variant="secondary"
                      size="small"
                      className="w-full data-popup-open:bg-components-button-secondary-bg-hover data-popup-open:inset-ring-components-button-secondary-border-hover"
                    />
                  }
                >
                  <span aria-hidden className="mr-1 i-ri-add-line size-4" />
                  {addLabel}
                </ComboboxTrigger>
                <ComboboxPortal>
                  <ComboboxPositioner placement="bottom">
                    <ComboboxPopup
                      aria-label={searchLabel}
                      className="w-[min(20rem,var(--available-width))]"
                    >
                      <ComboboxInputGroup>
                        <ComboboxInput
                          ref={pickerInputRef}
                          aria-label={searchLabel}
                          placeholder={searchLabel}
                        />
                      </ComboboxInputGroup>
                      <ComboboxStatus>
                        {isLoading ? t(($) => $.loading, { ns: 'common' }) : null}
                      </ComboboxStatus>
                      <ComboboxList<SelectedKb>
                        aria-label={t(($) => $['apiKeyModal.scopeSpecificDatasets'], {
                          ns: 'appApi',
                        })}
                      >
                        {knowledgeFsEnabled && (
                          <ComboboxGroup items={knowledgeSpaces}>
                            <ComboboxGroupLabel>
                              {t(($) => $['apiKeyModal.pickerKnowledgeSpaces'], { ns: 'appApi' })}
                            </ComboboxGroupLabel>
                            <ComboboxCollection<SelectedKb>>
                              {renderPickerOption}
                            </ComboboxCollection>
                          </ComboboxGroup>
                        )}
                        <ComboboxGroup items={datasets}>
                          {knowledgeFsEnabled && (
                            <ComboboxGroupLabel>
                              {t(($) => $['apiKeyModal.pickerLegacyDatasets'], { ns: 'appApi' })}
                            </ComboboxGroupLabel>
                          )}
                          <ComboboxCollection<SelectedKb>>{renderPickerOption}</ComboboxCollection>
                        </ComboboxGroup>
                      </ComboboxList>
                      <ComboboxEmpty>
                        {isLoading || hasLookupError ? null : t(($) => $.noData, { ns: 'common' })}
                      </ComboboxEmpty>
                      {knowledgeFsEnabled && (
                        <PickerPagination
                          query={knowledgeSpacesQuery}
                          errorLabel={t(($) => $['apiKeyModal.loadKnowledgeSpacesError'], {
                            ns: 'appApi',
                          })}
                          loadMoreLabel={t(($) => $['apiKeyModal.loadMoreKnowledgeSpaces'], {
                            ns: 'appApi',
                          })}
                          onSettled={focusPickerInput}
                        />
                      )}
                      <PickerPagination
                        query={datasetsQuery}
                        errorLabel={t(($) => $['apiKeyModal.loadDatasetsError'], { ns: 'appApi' })}
                        loadMoreLabel={t(($) => $['apiKeyModal.loadMoreDatasets'], {
                          ns: 'appApi',
                        })}
                        onSettled={focusPickerInput}
                      />
                    </ComboboxPopup>
                  </ComboboxPositioner>
                </ComboboxPortal>
              </Combobox>
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" disabled={isCreating} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" disabled={!canCreate} loading={isCreating}>
          {t(($) => $['operation.create'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </form>
  )
}
