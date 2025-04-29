import { VectorSearch } from '@/app/components/base/icons/src/vender/knowledge'
import OptionCard from '../option-card'

const VectorSearchCard = () => {
  return (
    <OptionCard
      icon={<VectorSearch className='h-[15px] w-[15px] text-text-tertiary' />}
      title='Vector Search'
      description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
      effectColor='purple'
    >
      <div className='flex flex-col gap-2'>
        <div>Vector Search Settings</div>
        <div>Additional Settings</div>
      </div>
    </OptionCard>
  )
}

export default VectorSearchCard
