import type { FC } from 'react'
import React from 'react'
import type { NodeProps } from '@/app/components/workflow/types'

const MqNode: FC<NodeProps<any>> = ({ data }) => {
  return (
    <div style={{
      marginBottom: '16px',
      padding: '12px',
      backgroundColor: '#f8f9fa',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          marginBottom: '4px',
          fontSize: '14px',
          color: '#495057',
          fontWeight: '500',
        }}>
          Channel Name
        </label>
        <input
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ced4da',
            borderRadius: '4px',
            fontSize: '14px',
            transition: 'border-color 0.15s ease-in-out',
            boxSizing: 'border-box',
          }}
          type="text"
          value={data.channelName || ''}
          placeholder="请输入频道名称"
          readOnly
        />
      </div>
      <div>
        <label style={{
          display: 'block',
          marginBottom: '4px',
          fontSize: '14px',
          color: '#495057',
          fontWeight: '500',
        }}>
          Message
        </label>
        <textarea
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ced4da',
            borderRadius: '4px',
            fontSize: '14px',
            transition: 'border-color 0.15s ease-in-out',
            boxSizing: 'border-box',
            minHeight: '100px',
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: '1.5',
          }}
          value={data.mqValue || ''}
          placeholder="请输入要发送的消息"
          readOnly
        />
      </div>
    </div>
  )
}

export default React.memo(MqNode)
