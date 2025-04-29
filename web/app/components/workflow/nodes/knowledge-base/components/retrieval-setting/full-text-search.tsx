import { FullTextSearch } from '@/app/components/base/icons/src/vender/knowledge'
import OptionCard from '../option-card'

const FullTextSearchCard = () => {
  return (
    <OptionCard
      icon={<FullTextSearch className='h-[15px] w-[15px] text-text-tertiary' />}
      title='Full-Text Search'
      description="Execute full-text search and vector searches simultaneously, re-rank to select the best match for the user's query. Users can choose to set weights or configure to a Rerank model."
      effectColor='purple'
    >
      <div className='flex flex-col gap-2'>
        <div>Vector Search Settings</div>
        <div>Additional Settings</div>
      </div>
    </OptionCard>
  )
}

export default FullTextSearchCard
