import Button from '@/app/components/base/button'
import { RiAddCircleFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useJsonSchemaConfigStore } from '../store'
import { useCallback } from 'react'
import { useMittContext } from '../context'

const AddField = () => {
  const { t } = useTranslation()
  const setIsAddingNewField = useJsonSchemaConfigStore(state => state.setIsAddingNewField)
  const { emit } = useMittContext()

  const handleAddField = useCallback(() => {
    setIsAddingNewField(true)
    emit('addField', { path: [] })
  }, [setIsAddingNewField, emit])

  return (
    <div className='pl-5 py-2'>
      <Button
        size='small'
        variant='secondary-accent'
        className='flex items-center gap-x-[1px]'
        onClick={handleAddField}
      >
        <RiAddCircleFill className='w-3.5 h-3.5'/>
        <span className='px-[3px]'>{t('workflow.nodes.llm.jsonSchema.addField')}</span>
      </Button>
    </div>
  )
}

export default AddField
