import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import MetadataIcon from './metadata-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { MetadataInDoc } from '@/models/datasets'

const AddCondition = ({
  metadataList,
  handleAddCondition,
}: Pick<MetadataShape, 'handleAddCondition' | 'metadataList'>) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  const filteredMetadataList = useMemo(() => {
    return metadataList?.filter(metadata => metadata.name.includes(searchText))
  }, [metadataList, searchText])

  const handleAddConditionWrapped = useCallback((item: MetadataInDoc) => {
    handleAddCondition?.(item)
    setOpen(false)
  }, [handleAddCondition])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 3,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          size='small'
          variant='secondary'
        >
          <RiAddLine className='h-3.5 w-3.5' />
          {t('workflow.nodes.knowledgeRetrieval.metadata.panel.add')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              placeholder={t('workflow.nodes.knowledgeRetrieval.metadata.panel.search')}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
          <div className='p-1'>
            {
              filteredMetadataList?.map(metadata => (
                <div
                  key={metadata.name}
                  className='system-sm-medium flex h-6 cursor-pointer items-center rounded-md px-3 text-text-secondary hover:bg-state-base-hover'
                >
                  <div className='mr-1 p-[1px]'>
                    <MetadataIcon type={metadata.type} />
                  </div>
                  <div
                    className='grow truncate'
                    title={metadata.name}
                    onClick={() => handleAddConditionWrapped(metadata)}
                  >
                    {metadata.name}
                  </div>
                  <div className='system-xs-regular shrink-0 text-text-tertiary'>{metadata.type}</div>
                </div>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default AddCondition
