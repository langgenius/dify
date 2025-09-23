import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Memory } from '@/app/components/base/icons/src/vender/line/others'

type Props = {
  onAddMemory: () => void
}

const AddMemoryButton = ({ onAddMemory }: Props) => {
  const { t } = useTranslation()

  return (
    <div className='ml-1.5 mt-2.5'>
      <Button
        variant='ghost'
        size='small'
        className='text-text-tertiary'
        onClick={onAddMemory}
      >
        <Memory className='h-3.5 w-3.5' />
        <span className='ml-1'>{t('workflow.nodes.llm.memory.addButton')}</span>
      </Button>
    </div>
  )
}

export default AddMemoryButton
