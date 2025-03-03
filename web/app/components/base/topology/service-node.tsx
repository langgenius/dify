import React, { useCallback } from 'react'
import { Handle, Position } from 'reactflow'
const handleStyle = { left: 10 }
const ServiceNode = React.memo(({ data, isConnectable }) => {
  const onChange = useCallback((evt) => {}, [])

  return (
    <div className="rounded-[15px]">
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="invisible"
      />
      <div
        className="shadow-xs border-[2px] border-transparen w-[200px] min-h-[60px] p-2 rounded-[15px]  overflow-hidden bg-[#fcfdff]/80"
      >
        <div className="absolute top-0 left-0">
        </div>
        <div className="text-center text-lg pt-2 px-2">
          {data.label}
          <div className="text-xs text-gray-500 text-left  break-all">{data.endpoint}</div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="b"
        isConnectable={isConnectable}
        className="invisible"
      />
    </div>
  )
})

export default ServiceNode
