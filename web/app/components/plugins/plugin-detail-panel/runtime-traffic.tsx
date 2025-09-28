'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/service/base'
import Toast from '@/app/components/base/toast'
import { RiArrowLeftRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { approveBlueGreen, cancelBlueGreen } from '@/service/plugins'

type Detail = {
  plugin_unique_identifier: string
  connections: number
}

type Snapshot = {
  plugin_id: string
  total_connections: number
  blue_green: boolean
  mode?: 'auto' | 'manual'
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

const extractVersion = (uid: string) => {
  // uid format: author/plugin_id:version@checksum
  const noChecksum = uid.split('@')[0]
  const parts = noChecksum.split(':')
  return parts.length > 1 ? parts[1] : noChecksum
}

type Props = { pluginId: string; onRefresh?: () => void }
const RuntimeTraffic: React.FC<Props> = ({ pluginId, onRefresh }) => {
  const { t } = useTranslation()
  const historyRef = useRef<Record<string, number[]>>({})
  const [monitoring, setMonitoring] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const firstLoadRef = useRef(true)
  const prevBlueGreenRef = useRef<boolean | undefined>(undefined)

  const { data } = useQuery({
    queryKey: ['plugin-runtime-connections', pluginId],
    queryFn: async () => {
      const res = await get<Response>('/workspaces/current/plugin/runtime/connections', { params: { plugin_id: pluginId } })
      return res
    },
    enabled: monitoring,
    refetchInterval: 2000,
  })

  const snapshot = useMemo(() => data?.list?.[0], [data])

  // trend history, max 18 points for fixed width
  useEffect(() => {
    if (!snapshot) return
    const entries: Detail[] = []
    if (snapshot.active_version) entries.push(snapshot.active_version)
    if (snapshot.draining_versions) entries.push(...snapshot.draining_versions)
    const h = historyRef.current
    entries.forEach((d) => {
      const key = d.plugin_unique_identifier
      h[key] = [...(h[key] || []), d.connections].slice(-18)
    })
  }, [snapshot])

  // completion detection with first-load guard
  useEffect(() => {
    if (!snapshot) return
    if (firstLoadRef.current) {
      // Record initial state; do NOT hide or stop monitoring on first load
      prevBlueGreenRef.current = snapshot.blue_green
      firstLoadRef.current = false
      return
    }
    // Only when transitioning from in-progress to completed, hide and stop
    if (prevBlueGreenRef.current === true && !snapshot.blue_green) {
      Toast.notify({ type: 'success', message: t('plugin.runtimeTraffic.toastCompleted') })
      onRefresh?.()
      setHidden(true)
      setRollingBack(false)
      setMonitoring(false)
    }
    prevBlueGreenRef.current = snapshot.blue_green
  }, [snapshot, onRefresh, t])

  const hasDraining = (snapshot?.draining_versions?.length ?? 0) > 0
  if (hidden || !snapshot || !snapshot.blue_green || !hasDraining)
    return null

  return (
    <div className='p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <div className='flex items-center gap-2 text-slate-700'>
          <RiArrowLeftRightLine className='h-4 w-4 text-slate-500' />
          <div className='text-sm font-medium text-slate-800'>{t('plugin.runtimeTraffic.title')}</div>
          <span className='rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600'>
            {t('plugin.runtimeTraffic.modePrefix')}
            {rollingBack ? t('plugin.runtimeTraffic.modeRollback') : (snapshot.mode === 'manual' ? t('plugin.runtimeTraffic.modeManual') : t('plugin.runtimeTraffic.modeAuto'))}
          </span>
        </div>
        {snapshot.mode === 'manual' && (
          <div>
            <button
              className='inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50'
              disabled={(snapshot.draining_versions || []).some(d => d.connections > 0)}
              onClick={async () => {
                await approveBlueGreen(pluginId)
                Toast.notify({ type: 'success', message: t('plugin.runtimeTraffic.toastCompleted') })
                setMonitoring(false)
                setHidden(true)
                onRefresh?.()
              }}
            >
              {t('plugin.runtimeTraffic.approve')}
            </button>
            <button
              className='ml-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50'
              onClick={async () => {
                const target = snapshot.draining_versions?.[0]
                if (!target) return
                await cancelBlueGreen(target.plugin_unique_identifier)
                Toast.notify({ type: 'success', message: t('plugin.runtimeTraffic.toastRolledBack') })
                setRollingBack(true)
              }}
            >{t('plugin.runtimeTraffic.cancel')}</button>
          </div>
        )}
      </div>

      <div className='space-y-3 rounded-xl border border-slate-200 bg-white p-3'>
        {snapshot.active_version && (
          <div className='flex items-center justify-between rounded-xl border border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 px-3 py-3 shadow-sm'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='rounded-md bg-green-600 px-2 py-0.5 text-xs font-medium text-white'>{t('plugin.runtimeTraffic.newVersion')}</span>
              <span className='rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800'>
                {extractVersion(snapshot.active_version.plugin_unique_identifier)}
              </span>
            </div>
            <div className='flex items-center gap-3 text-slate-600'>
              <div className='text-sm tabular-nums'>{t('plugin.runtimeTraffic.connections')}: {snapshot.active_version.connections}</div>
              <div className='w-[18ch] overflow-hidden font-mono text-xs text-slate-500'>{spark(historyRef.current[snapshot.active_version.plugin_unique_identifier] || [])}</div>
            </div>
          </div>
        )}

        {(snapshot.draining_versions || []).map(d => (
          <div key={d.plugin_unique_identifier} className='flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700'>{t('plugin.runtimeTraffic.oldVersion')}</span>
              <span className='rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700'>
                {extractVersion(d.plugin_unique_identifier)}
              </span>
            </div>
            <div className='flex items-center gap-3 text-slate-600'>
              <div className='text-sm tabular-nums'>{t('plugin.runtimeTraffic.connections')}: {d.connections}</div>
              <div className='w-[18ch] overflow-hidden font-mono text-xs text-slate-500'>{spark(historyRef.current[d.plugin_unique_identifier] || [])}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default RuntimeTraffic
