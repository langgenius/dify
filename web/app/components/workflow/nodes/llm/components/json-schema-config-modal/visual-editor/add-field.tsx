import React, { useCallback } from 'react'
import Button from '@/app/components/base/button'
import { RiAddCircleFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useVisualEditorStore } from './store'
import { useMittContext } from './context'

const AddField = () => {
  const { t } = useTranslation()
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const { emit } = useMittContext()

  const handleAddField = useCallback(() => {
    setIsAddingNewField(true)
    // fix: when user change the last property type, the 'hoveringProperty' value will be reset by 'setHoveringPropertyDebounced(null)', that cause the EditCard not showing
    setTimeout(() => {
      emit('addField', { path: [] })
    }, 100)
  }, [setIsAddingNewField, emit])

  return (
    <div className='py-2 pl-5'>
      <Button
        size='small'
        variant='secondary-accent'
        className='flex items-center gap-x-[1px]'
        onClick={handleAddField}
      >
        <RiAddCircleFill className='h-3.5 w-3.5'/>
        <span className='px-[3px]'>{t('workflow.nodes.llm.jsonSchema.addField')}</span>
      </Button>
    </div>
  )
}

export default React.memo(AddField)
