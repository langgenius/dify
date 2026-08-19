'use client'
import type { ApiKeyItem } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useInfiniteDatasets } from '@/service/knowledge/use-dataset'
import SecretKeyGenerateModal from './secret-key-generate'

type Scope = 'all' | 'specific'

type SelectedKb = { id: string; name: string }

type AddApiKeyModalProps = {
  isShow: boolean
  onClose: () => void
}

const AddApiKeyModal = ({ isShow, onClose }: AddApiKeyModalProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const createDatasetApiKey = useMutation(consoleQuery.datasets.apiKeys.post.mutationOptions())
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SelectedKb[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [generatedKey, setGeneratedKey] = useState<Pick<ApiKeyItem, 'token'> | undefined>(undefined)

  const { data: datasetsPages } = useInfiniteDatasets(
    { keyword },
    { enabled: isShow && pickerOpen },
  )
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

  const reset = () => {
    setScope('all')
    setSelected([])
    setKeyword('')
    setPickerOpen(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const onCreate = () => {
    if (!canCreate || createDatasetApiKey.isPending) return
    createDatasetApiKey.mutate(
      { body: { dataset_ids: scope === 'specific' ? selected.map((kb) => kb.id) : [] } },
      {
        onSuccess: (apiKey) => {
          void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.apiKeys.get.key() })
          setGeneratedKey(apiKey)
          reset()
          onClose()
        },
      },
    )
  }

  return (
    <>
      <Dialog open={isShow} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="w-full max-w-[560px]! border-none">
          <div className="relative flex flex-col gap-y-1 px-6 pt-6">
            <DialogTitle className="title-lg-semi-bold text-text-primary">
              {t(($) => $['apiKeyModal.addTitle'], { ns: 'appApi' })}
            </DialogTitle>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['apiKeyModal.addSubtitle'], { ns: 'appApi' })}
            </div>
            <button
              type="button"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-4 right-4 flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
              onClick={handleClose}
            >
              <span className="i-ri-close-line size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-y-3 px-6 py-4">
            <div className="system-sm-semibold text-text-secondary">
              {t(($) => $['apiKeyModal.knowledgeBaseAccess'], { ns: 'appApi' })}
            </div>
            <RadioGroup<Scope> value={scope} onValueChange={setScope}>
              <div className="flex flex-col gap-y-3">
                <label
                  htmlFor="api-key-scope-all"
                  className="flex cursor-pointer items-start gap-x-2"
                >
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
                  className="flex cursor-pointer items-start gap-x-2"
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
              <div className="flex flex-col gap-y-2">
                <div className="system-sm-semibold text-text-secondary">
                  {t(($) => $['apiKeyModal.selectedKnowledgeBases'], { ns: 'appApi' })}
                </div>
                <div className="flex flex-col gap-y-2 rounded-lg border-[0.5px] border-divider-subtle bg-components-panel-bg p-3">
                  {selected.length === 0 ? (
                    <div className="py-0.5 system-xs-regular text-text-tertiary">
                      {t(($) => $['apiKeyModal.noKnowledgeBasesSelected'], { ns: 'appApi' })}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-y-2">
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
                            className="flex items-center gap-x-1 rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg px-2 py-1"
                          >
                            <span className="max-w-40 truncate system-xs-medium text-text-secondary">
                              {kb.name}
                            </span>
                            <button
                              type="button"
                              aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                              className="i-ri-close-line size-3.5 shrink-0 border-none bg-transparent p-0 text-text-tertiary hover:text-text-secondary"
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
                          <span className="mr-1 i-ri-add-line size-4" />
                          {t(($) => $['apiKeyModal.addKnowledgeBase'], { ns: 'appApi' })}
                        </Button>
                      }
                    />
                    <PopoverContent placement="bottom" sideOffset={4} className="w-80 p-2">
                      <Input
                        size="small"
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
                              className="flex cursor-pointer items-center gap-x-2 rounded-md px-2 py-1.5 hover:bg-state-base-hover"
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

          <div className="flex justify-end gap-x-2 px-6 pb-6">
            <Button variant="secondary" onClick={handleClose}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              disabled={!canCreate || createDatasetApiKey.isPending}
              onClick={onCreate}
            >
              {t(($) => $['operation.create'], { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SecretKeyGenerateModal
        isShow={!!generatedKey}
        newKey={generatedKey}
        onClose={() => setGeneratedKey(undefined)}
      />
    </>
  )
}

export default AddApiKeyModal
