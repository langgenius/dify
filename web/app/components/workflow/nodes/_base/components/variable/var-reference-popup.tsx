'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useHover } from 'ahooks'
import cn from 'classnames'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'

type ObjectChildrenProps = {
  nodeId: string
  title: string
  data: Var[]
  objPath: string[]
  onChange: (value: ValueSelector) => void
}

type ItemProps = {
  nodeId: string
  title: string
  objPath: string[]
  itemData: Var
  onChange: (value: ValueSelector) => void
}

const Item: FC<ItemProps> = ({
  nodeId,
  title,
  objPath,
  itemData,
  onChange,
}) => {
  const isObj = itemData.type === 'object'
  const itemRef = useRef(null)
  const isItemHovering = useHover(itemRef)
  const handleChosen = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([nodeId, ...objPath, itemData.variable])
  }
  return (
    <div
      ref={itemRef}
      className={cn(isObj ? 'hover:bg-primary-50 pr-1' : 'hover:bg-gray-50 pr-[18px]', 'relative flex items-center h-6 w-[252px] pl-3  rounded-md cursor-pointer')}
      onClick={handleChosen}
    >
      <div className='flex items-center w-0 grow'>
        <Variable02 className='shrink-0 w-3.5 h-3.5 text-primary-500' />
        <div className='ml-1 w-0 grow text-ellipsis text-[13px] font-normal text-gray-900'>{itemData.variable}</div>
      </div>
      <div className='ml-1 shrink-0 text-xs font-normal text-gray-500'>{itemData.type}</div>
      {isObj && (
        <ChevronRight className='ml-0.5 w-3 h-3 text-gray-500' />
      )}
      {isObj && isItemHovering && (
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        <ObjectChildren
          nodeId={nodeId}
          title={title}
          objPath={[...objPath, itemData.variable]}
          data={itemData.children as Var[]}
          onChange={onChange}
        />
      )}
    </div>
  )
}

const ObjectChildren: FC<ObjectChildrenProps> = ({
  title,
  nodeId,
  objPath,
  data,
  onChange,
}) => {
  const currObjPath = objPath

  return (
    <div className='absolute right-[248px] top-[-2px] bg-white rounded-lg border border-gray-200 shadow-lg space-y-1'>
      <div className='flex items-center h-[22px] px-3 text-xs font-normal text-gray-700'><span className='text-gray-500'>{title}.</span>{currObjPath.join('.')}</div>
      {
        data.map((v, i) => (
          <Item
            key={i}
            nodeId={nodeId}
            title={title}
            objPath={objPath}
            itemData={v}
            onChange={onChange}
          />
        ))
      }
    </div>
  )
}

type Props = {
  vars: NodeOutPutVar[]
  onChange: (value: ValueSelector) => void
}
const VarReferencePopup: FC<Props> = ({

  vars,
  onChange,
}) => {
  return (
    <div className='p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1'>
      {vars.map((item, i) => (
        <div key={i}>
          <div className='flex items-center h-[22px] px-3 text-xs font-medium text-gray-500 uppercase'>{item.title}</div>
          {item.vars.map((v, j) => (
            <Item
              key={j}
              title={item.title}
              nodeId={item.nodeId}
              objPath={[]}
              itemData={v}
              onChange={onChange}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
export default React.memo(VarReferencePopup)
