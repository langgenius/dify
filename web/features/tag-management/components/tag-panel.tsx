import type { Tag, TagType } from '@/contract/console/tags'
import { toast } from '@langgenius/dify-ui/toast'
import { noop } from 'es-toolkit/function'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { useCreateTagMutation } from '../hooks/use-tag-mutations'

type TagPanelProps = {
  type: TagType
  selectedTagIds: string[]
  selectedTags: Tag[]
  onOpenTagManagement?: () => void
  tagList: Tag[]
  draftTagIds?: string[]
  onDraftTagIdsChange?: (tagIds: string[]) => void
  onClose?: () => void
}
export const TagPanel = (props: TagPanelProps) => {
  const { t } = useTranslation()
  const { type, selectedTagIds, selectedTags, tagList, onOpenTagManagement, onClose } = props
  const createTagMutation = useCreateTagMutation()
  const [localDraftTagIds, setLocalDraftTagIds] = useState<string[]>(selectedTagIds)
  const draftTagIds = props.draftTagIds ?? localDraftTagIds
  const onDraftTagIdsChange = props.onDraftTagIdsChange ?? setLocalDraftTagIds
  const [keywords, setKeywords] = useState('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }
  const notExisted = useMemo(() => {
    return tagList.every(tag => tag.type === type && tag.name !== keywords)
  }, [type, tagList, keywords])
  const filteredSelectedTagList = useMemo(() => {
    return selectedTags.filter(tag => tag.name.includes(keywords))
  }, [keywords, selectedTags])
  const filteredTagList = useMemo(() => {
    return tagList.filter(tag => tag.type === type && !selectedTagIds.includes(tag.id) && tag.name.includes(keywords))
  }, [type, tagList, selectedTagIds, keywords])
  const createNewTag = () => {
    if (!keywords)
      return
    if (createTagMutation.isPending)
      return

    createTagMutation.mutate({
      body: {
        name: keywords,
        type,
      },
    }, {
      onSuccess: () => {
        toast.success(t('tag.created', { ns: 'common' }))
        setKeywords('')
      },
      onError: () => {
        toast.error(t('tag.failed', { ns: 'common' }))
      },
    })
  }
  const selectTag = (tagId: string) => {
    if (draftTagIds.includes(tagId))
      onDraftTagIdsChange(draftTagIds.filter(v => v !== tagId))
    else
      onDraftTagIdsChange([...draftTagIds, tagId])
  }
  return (
    <div className="relative w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur">
      <div className="p-2 pb-1">
        <Input showLeftIcon showClearIcon value={keywords} placeholder={t('tag.selectorPlaceholder', { ns: 'common' }) || ''} onChange={e => handleKeywordsChange(e.target.value)} onClear={() => handleKeywordsChange('')} />
      </div>
      {keywords && notExisted && (
        <div className="p-1">
          <div className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover" data-testid="create-tag-option" onClick={createNewTag}>
            <span className="i-ri-add-line h-4 w-4 text-text-tertiary" />
            <div className="grow truncate px-1 system-md-regular text-text-secondary">
              {`${t('tag.create', { ns: 'common' })} `}
              <span className="system-md-medium">{`'${keywords}'`}</span>
            </div>
          </div>
        </div>
      )}
      {keywords && notExisted && filteredTagList.length > 0 && (<Divider type="horizontal" className="my-0 h-px bg-divider-subtle" />)}
      {(filteredTagList.length > 0 || filteredSelectedTagList.length > 0) && (
        <div className="max-h-[232px] overflow-y-auto p-1">
          {filteredSelectedTagList.map(tag => (
            <div key={tag.id} className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover" onClick={() => selectTag(tag.id)} data-testid="tag-row">
              <Checkbox className="shrink-0" checked={draftTagIds.includes(tag.id)} onCheck={noop} id={tag.id} />
              <div title={tag.name} className="grow truncate px-1 system-md-regular text-text-secondary">
                {tag.name}
              </div>
            </div>
          ))}
          {filteredTagList.map(tag => (
            <div key={tag.id} className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover" onClick={() => selectTag(tag.id)} data-testid="tag-row">
              <Checkbox className="shrink-0" checked={draftTagIds.includes(tag.id)} onCheck={noop} id={tag.id} />
              <div title={tag.name} className="grow truncate px-1 system-md-regular text-text-secondary">
                {tag.name}
              </div>
            </div>
          ))}
        </div>
      )}
      {!keywords && !filteredTagList.length && !filteredSelectedTagList.length && (
        <div className="p-1">
          <div className="flex flex-col items-center gap-y-1 p-3">
            <span className="i-ri-price-tag-3-line h-6 w-6 text-text-quaternary" />
            <div className="system-xs-regular text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
          </div>
        </div>
      )}
      <Divider type="horizontal" className="my-0 h-px bg-divider-subtle" />
      <div className="p-1">
        <div
          className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
          onClick={() => {
            onOpenTagManagement?.()
            onClose?.()
          }}
        >
          <span className="i-ri-price-tag-3-line h-4 w-4 text-text-tertiary" />
          <div className="grow truncate px-1 system-md-regular text-text-secondary">
            {t('tag.manageTags', { ns: 'common' })}
          </div>
        </div>
      </div>
    </div>
  )
}
