'use client'
import React, { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/service/base'

type Detail = {
  plugin_unique_identifier: string
  connections: number
}
type Snapshot = {
  plugin_id: string
  total_connections: number
  blue_green: boolean
  active_version?: Detail
  draining_versions?: Detail[]
}
type Response = { list: Snapshot[] }

const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const spark = (values: number[]) => {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  return values.map(v => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))]).join('')
}

const RuntimeTraffic: React.FC<{ pluginId: string }> = ({ pluginId }) => {
  const historyRef = useRef<Record<string, number[]>>({})
  const { data } = useQuery({
    queryKey: ['plugin-runtime-connections', pluginId],
    queryFn: async () => {
      const res = await get<{ list: Snapshot[] }>('/workspaces/current/plugin/runtime/connections', { params: { plugin_id: pluginId } })
      return res
    },
    refetchInterval: 2000,
  })

  const snapshot = useMemo(() => data?.list?.[0], [data])

  useEffect(() => {
    if (!snapshot) return
    const entries: Detail[] = []
    if (snapshot.active_version) entries.push(snapshot.active_version)
    if (snapshot.draining_versions) entries.push(...snapshot.draining_versions)
    const h = historyRef.current
    entries.forEach((d) => {
      const key = d.plugin_unique_identifier
      h[key] = [...(h[key] || []), d.connections].slice(-30)
    })
  }, [snapshot])

  if (!snapshot)
    return null

  return (
    <div className='px-4 py-3'>
      <div className='system-md-semibold mb-2'>流量观察（蓝绿）</div>
      <div className='space-y-1'>
        {snapshot.active_version && (
          <div className='flex flex-col text-xs'>
            <div className='text-text-secondary'>新/当前版本</div>
            <div className='truncate'>{snapshot.active_version.plugin_unique_identifier.split('@')[0]}</div>
            <div className='tabular-nums'>{snapshot.active_version.connections}</div>
            <div className='font-mono text-text-tertiary'>{spark(historyRef.current[snapshot.active_version.plugin_unique_identifier] || [])}</div>
          </div>
        )}
        {snapshot.draining_versions?.map(d => (
          <div key={d.plugin_unique_identifier} className='flex flex-col text-xs'>
            <div className='text-text-secondary'>旧版本</div>
            <div className='truncate'>{d.plugin_unique_identifier.split('@')[0]}</div>
            <div className='tabular-nums'>{d.connections}</div>
            <div className='font-mono text-text-tertiary'>{spark(historyRef.current[d.plugin_unique_identifier] || [])}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default RuntimeTraffic
