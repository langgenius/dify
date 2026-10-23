'use client'

import type { DialogContentProps, DialogProps } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Combobox,
  ComboboxEmpty,
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

type Scope = 'all' | 'specific'
type SelectedKb = { id: string; name: string }

type DatasetScopeDialogProps = Required<Pick<DialogProps, 'open' | 'onOpenChange'>> &
  Pick<DialogContentProps, 'finalFocus'> & {
    isCreating: boolean
    createDisabled: boolean
    // Emits the knowledge-base ids to scope the new key to. An empty array means the
    // key can access every knowledge base in the workspace (the "all" scope).
    onConfirm: (datasetIds: string[]) => void
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

function DatasetScopeContent({
  isCreating,
  createDisabled,
  onConfirm,
}: Omit<DatasetScopeDialogProps, 'open' | 'finalFocus' | 'onOpenChange'>) {
  const { t } = useTranslation(['appApi', 'common'])
  const scopeId = useId()
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SelectedKb[]>([])
  const [keyword, setKeyword] = useState('')

  const { data: datasetsPages, isLoading } = useInfiniteQuery(
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
      (datasetsPages?.pages ?? []).flatMap((page) =>
        page.data.map(({ id, name }) => ({ id, name })),
      ),
    [datasetsPages],
  )
  const selectedIds = useMemo(() => new Set(selected.map((kb) => kb.id)), [selected])
  const addLabel = t(($) => $['apiKeyModal.addKnowledgeBase'], { ns: 'appApi' })
  const searchLabel = t(($) => $['apiKeyModal.searchKnowledgeBases'], { ns: 'appApi' })

  const removeKb = (id: string) => setSelected((prev) => prev.filter((kb) => kb.id !== id))

  const canCreate = !createDisabled && (scope === 'all' || selected.length > 0)

  const handleConfirm = () => {
    if (!canCreate || isCreating) return
    onConfirm(scope === 'specific' ? selected.map((kb) => kb.id) : [])
  }

  return (
    <form
      className="contents"
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
        <DialogHeaderCloseButton
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
                items={datasets}
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
                  <ComboboxPositioner side="bottom" align="center">
                    <ComboboxPopup
                      aria-label={searchLabel}
                      className="w-[min(20rem,var(--available-width))]"
                    >
                      <ComboboxInputGroup>
                        <ComboboxInput aria-label={searchLabel} placeholder={searchLabel} />
                      </ComboboxInputGroup>
                      <ComboboxStatus>
                        {isLoading ? t(($) => $.loading, { ns: 'common' }) : null}
                      </ComboboxStatus>
                      <ComboboxList<SelectedKb>
                        aria-label={t(($) => $['apiKeyModal.scopeSpecificDatasets'], {
                          ns: 'appApi',
                        })}
                      >
                        {(kb) => (
                          <ComboboxItem<SelectedKb>
                            key={kb.id}
                            value={kb}
                            className="grid-cols-[auto_1fr]"
                          >
                            {/* Visual only: the option owns the click target and the selected state. */}
                            <span aria-hidden inert className="flex">
                              <Checkbox checked={selectedIds.has(kb.id)} />
                            </span>
                            <span className="min-w-0 truncate system-sm-regular text-text-secondary">
                              {kb.name}
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                      <ComboboxEmpty>
                        {isLoading ? null : t(($) => $.noData, { ns: 'common' })}
                      </ComboboxEmpty>
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
