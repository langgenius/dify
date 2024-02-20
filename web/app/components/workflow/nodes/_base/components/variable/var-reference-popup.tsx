'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useHover } from 'ahooks'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type ObjectChildrenProps = {
  title: string
  data: Var[]
  objPath: string[]
}

type ItemProps = {
  title: string
  objPath: string[]
  itemData: Var
}

const Item: FC<ItemProps> = ({
  title,
  objPath,
  itemData,
}) => {
  const isObj = itemData.type === 'object'
  const itemRef = useRef(null)
  const isItemHovering = useHover(itemRef)

  return (
    <div ref={itemRef} className='relative flex items-center h-6 w-[252px] pl-3 pr-[18px] rounded-md cursor-pointer hover:bg-gray-50'>
      <div className='flex items-center w-0 grow'>
        <Variable02 className='shrink-0 w-3.5 h-3.5 text-primary-500' />
        <div className='ml-1 w-0 grow text-ellipsis text-[13px] font-normal text-gray-900'>{itemData.variable}</div>
      </div>
      <div className='ml-1 shrink-0 text-xs font-normal text-gray-500'>{itemData.type}</div>
      {isObj && isItemHovering && (
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        <ObjectChildren
          title={title}
          objPath={[...objPath, itemData.variable]}
          data={itemData.children as Var[]}
        />
      )}
    </div>
  )
}

const ObjectChildren: FC<ObjectChildrenProps> = ({
  title,
  objPath,
  data,
}) => {
  const currObjPath = objPath

  return (
    <div className='absolute right-[248px] top-[-2px] bg-white rounded-lg border border-gray-200 shadow-lg space-y-1'>
      <div className='flex items-center h-[22px] px-3 text-xs font-normal text-gray-700'><span className='text-gray-500'>{title}.</span>{currObjPath.join('.')}</div>
      {
        data.map((v, i) => (
          <Item
            key={i}
            title={title}
            objPath={objPath}
            itemData={v}
          />
        ))
      }
    </div>
  )
}

type Props = {
  vars: NodeOutPutVar[]
}
const VarReferencePopup: FC<Props> = ({
  vars,
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
              objPath={[]}
              itemData={v}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
export default React.memo(VarReferencePopup)
