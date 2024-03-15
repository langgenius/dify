'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useHover } from 'ahooks'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { type NodeOutPutVar, type ValueSelector, type Var, VarType } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'

type ObjectChildrenProps = {
  nodeId: string
  title: string
  data: Var[]
  objPath: string[]
  onChange: (value: ValueSelector) => void
  itemWidth?: number
}

type ItemProps = {
  nodeId: string
  title: string
  objPath: string[]
  itemData: Var
  onChange: (value: ValueSelector) => void
  itemWidth?: number
}

const Item: FC<ItemProps> = ({
  nodeId,
  title,
  objPath,
  itemData,
  onChange,
  itemWidth,
}) => {
  const isObj = itemData.type === VarType.object && itemData.children && itemData.children.length > 0
  const itemRef = useRef(null)
  const isItemHovering = useHover(itemRef)
  const handleChosen = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([nodeId, ...objPath, itemData.variable])
  }
  return (
    <div
      ref={itemRef}
      className={cn(
        isObj ? 'hover:bg-primary-50 pr-1' : 'hover:bg-gray-50 pr-[18px]',
        'relative w-full flex items-center h-6 pl-3  rounded-md cursor-pointer')
      }
      // style={{ width: itemWidth || 252 }}
      onClick={handleChosen}
    >
      <div className='flex items-center w-0 grow'>
        <Variable02 className='shrink-0 w-3.5 h-3.5 text-primary-500' />
        <div className='ml-1 w-0 grow text-ellipsis text-[13px] font-normal text-gray-900'>{itemData.variable}</div>
      </div>
      <div className='ml-1 shrink-0 text-xs font-normal text-gray-500 capitalize'>{itemData.type}</div>
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
          itemWidth={itemWidth}
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
  itemWidth,
}) => {
  const currObjPath = objPath

  return (
    <div className='absolute top-[-2px] bg-white rounded-lg border border-gray-200 shadow-lg space-y-1' style={{
      right: itemWidth ? itemWidth - 10 : 215,
      minWidth: 252,
    }}>
      <div className='flex items-center h-[22px] px-3 text-xs font-normal text-gray-700'><span className='text-gray-500'>{title}.</span>{currObjPath.join('.')}</div>
      {
        (data && data.length > 0)
        && data.map((v, i) => (
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
  itemWidth?: number
}
const VarReferencePopup: FC<Props> = ({
  vars,
  onChange,
  itemWidth,
}) => {
  const { t } = useTranslation()

  return (
    <div className='p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1' style={{
      width: itemWidth || 228,
    }}>
      {vars.length > 0
        ? vars.map((item, i) => (
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
                itemWidth={itemWidth}
              />
            ))}
          </div>
        ))
        : <div className='pl-3 leading-[18px] text-xs font-medium text-gray-500 uppercase'>{t('workflow.common.noVar')}</div>}
    </div>
  )
}
export default React.memo(VarReferencePopup)
