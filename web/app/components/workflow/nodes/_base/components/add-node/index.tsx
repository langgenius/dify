import type { FC, MouseEvent } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { FloatingPortal } from '@floating-ui/react'
import { useBlockSelectorContext } from '../../../../block-selector/context'
import type {
  BlockEnum,
  Node,
} from '../../../../types'
import { useAddBranch } from './hooks'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'

type AddNodeProps = {
  outgoers: Node[]
  onAddNextNode: (type: BlockEnum) => void
  branches?: { id: string; name: string }[]
}
const AddNode: FC<AddNodeProps> = ({
  onAddNextNode,
  branches,
}) => {
  const {
    refs,
    isOpen,
    setIsOpen,
    setDismissEnable,
    floatingStyles,
    getFloatingProps,
  } = useAddBranch()
  const {
    from,
    open,
    referenceRef,
    handleToggle,
  } = useBlockSelectorContext()
  const hasBranches = branches && !!branches.length
  const handleAdd = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()

    if (hasBranches)
      return setIsOpen(v => !v)

    handleToggle({
      placement: 'right',
      offset: 6,
      callback: onAddNextNode,
    })
  }
  const buttonRef = useMemo(() => {
    if (hasBranches)
      return refs.setReference

    if (from === 'node')
      return referenceRef

    return null
  }, [from, hasBranches, referenceRef, refs.setReference])
  const buttonShouldShow = useMemo(() => {
    if (hasBranches && isOpen)
      return true

    return open && from === 'node'
  }, [from, hasBranches, isOpen, open])

  return (
    <>
      <div
        ref={buttonRef}
        onClick={handleAdd}
        className={`
          hidden absolute -bottom-2 left-1/2 -translate-x-1/2 items-center justify-center 
          w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10 group-hover:flex
          ${buttonShouldShow && '!flex'}
        `}
      >
        <Plus02 className='w-2.5 h-2.5 text-white' />
      </div>
      {
        isOpen && hasBranches && (
          <FloatingPortal>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className='p-1 w-[108px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg'
            >
              {
                branches.map(branch => (
                  <div
                    key={branch.id}
                    className='flex items-center px-3 pr-2 h-[30px] text-[13px] font-medium text-gray-700 cursor-pointer rounded-lg hover:bg-gray-50'
                    onClick={() => {
                      setDismissEnable(false)
                      handleToggle({
                        open: true,
                        placement: 'right',
                        offset: 6,
                        callback: onAddNextNode,
                      })
                    }}
                  >
                    {branch.name}
                  </div>
                ))
              }
            </div>
          </FloatingPortal>
        )
      }
    </>
  )
}

export default memo(AddNode)
