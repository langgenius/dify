'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio-group'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteDatasets } from '@/service/knowledge/use-dataset'

type Scope = 'all' | 'specific'
type SelectedKb = { id: string; name: string }

type DatasetScopeDialogProps = {
  open: boolean
  isCreating: boolean
  onOpenChange: (open: boolean) => void
  // Emits the knowledge-base ids to scope the new key to. An empty array means the
  // key can access every knowledge base in the workspace (the "all" scope).
  onConfirm: (datasetIds: string[]) => void
}

// Scope picker shown when creating a workspace dataset API key. It lets the caller
// grant the key access to every knowledge base or to a specific selection, then hands
// the chosen ids back to the parent modal, which owns the create mutation.
export function DatasetScopeDialog({
  open,
  isCreating,
  onOpenChange,
  onConfirm,
}: DatasetScopeDialogProps) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SelectedKb[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  // Selection state resets by remounting: the parent bumps this dialog's `key` each time
  // it opens, so every open starts from these defaults with no reset-in-effect.
  const { data: datasetsPages } = useInfiniteDatasets({ keyword }, { enabled: open && pickerOpen })
  const datasets = useMemo(
    () => (datasetsPages?.pages ?? []).flatMap((page) => page.data),
    [datasetsPages],
  )
  const selectedIds = useMemo(() => new Set(selected.map((kb) => kb.id)), [selected])

  const toggleKb = (id: string, name: string) => {
    setSelected((prev) =>
      prev.some((kb) => kb.id === id) ? prev.filter((kb) => kb.id !== id) : [...prev, { id, name }],
    )
  }

  const removeKb = (id: string) => setSelected((prev) => prev.filter((kb) => kb.id !== id))

  const canCreate = scope === 'all' || selected.length > 0

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isCreating) return
    onOpenChange(nextOpen)
  }

  const handleConfirm = () => {
    if (!canCreate || isCreating) return
    onConfirm(scope === 'specific' ? selected.map((kb) => kb.id) : [])
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex w-140 flex-col overflow-hidden p-0">
        <div className="flex shrink-0 flex-col gap-1 px-6 pt-6 pr-14 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['apiKeyModal.addTitle'], { ns: 'appApi' })}
          </DialogTitle>
          <DialogDescription className="system-sm-regular text-text-tertiary">
            {t(($) => $['apiKeyModal.addSubtitle'], { ns: 'appApi' })}
          </DialogDescription>
        </div>
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
              disabled={isCreating}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />

        <div className="flex flex-col gap-3 px-6 py-4">
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['apiKeyModal.knowledgeBaseAccess'], { ns: 'appApi' })}
          </div>
          <RadioGroup<Scope> value={scope} onValueChange={setScope}>
            <div className="flex flex-col gap-3">
              <label htmlFor="api-key-scope-all" className="flex cursor-pointer items-start gap-2">
                <Radio id="api-key-scope-all" value="all" className="mt-0.5" />
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
                htmlFor="api-key-scope-specific"
                className="flex cursor-pointer items-start gap-2"
              >
                <Radio id="api-key-scope-specific" value="specific" className="mt-0.5" />
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
                          <button
                            type="button"
                            aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                            className="i-ri-close-line size-3.5 shrink-0 cursor-pointer border-none bg-transparent p-0 text-text-tertiary hover:text-text-secondary"
                            onClick={() => removeKb(kb.id)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button variant="secondary" size="small" className="w-full">
                        <span aria-hidden className="mr-1 i-ri-add-line size-4" />
                        {t(($) => $['apiKeyModal.addKnowledgeBase'], { ns: 'appApi' })}
                      </Button>
                    }
                  />
                  <PopoverContent placement="bottom" sideOffset={4} className="w-80 p-2">
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder={t(($) => $['apiKeyModal.searchKnowledgeBases'], {
                        ns: 'appApi',
                      })}
                    />
                    <ScrollArea className="mt-2 max-h-60">
                      <div className="flex flex-col">
                        {datasets.map((ds) => (
                          <label
                            key={ds.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-state-base-hover"
                          >
                            <Checkbox
                              checked={selectedIds.has(ds.id)}
                              onCheckedChange={() => toggleKb(ds.id, ds.name)}
                            />
                            <span className="min-w-0 grow truncate system-sm-regular text-text-secondary">
                              {ds.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-6 pb-6">
          <Button variant="secondary" disabled={isCreating} onClick={() => handleOpenChange(false)}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button disabled={!canCreate} loading={isCreating} onClick={handleConfirm}>
            {t(($) => $['operation.create'], { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
