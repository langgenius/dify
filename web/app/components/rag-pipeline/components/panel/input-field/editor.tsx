import { useStore } from '@/app/components/workflow/store'
import InputFieldForm from '@/app/components/base/form/form-scenarios/input-field'
import { useCallback } from 'react'
import { RiCloseLine } from '@remixicon/react'

const InputFieldEditor = () => {
  const setShowInputFieldEditor = useStore(state => state.setShowInputFieldEditor)

  const closeEditor = useCallback(() => {
    setShowInputFieldEditor?.(false)
  }, [setShowInputFieldEditor])

  return (
    <div className='relative flex h-fit w-[400px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'>
      <div className='system-xl-semibold flex items-center pb-1 pl-4 pr-11 pt-3.5 text-text-primary'>
        Add Input Field
      </div>
      <button
        type='button'
        className='absolute right-2.5 top-2.5 flex size-8 items-center justify-center'
        onClick={closeEditor}
      >
        <RiCloseLine className='size-4 text-text-tertiary' />
      </button>
      <InputFieldForm
        initialData={undefined}
        supportFile
        onCancel={closeEditor}
        onSubmit={(value) => {
          console.log('submit', value)
          closeEditor()
        }}
      />
    </div>
  )
}

export default InputFieldEditor
