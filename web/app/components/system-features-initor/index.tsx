'use client'
import {
  useEffect,
  useState,
} from 'react'
import { useSystemFeaturesStore } from './store'
import { getSystemFeatures } from '@/service/common'

const SystemFeaturesInitor = ({
  children,
}: { children: React.ReactElement }) => {
  const [init, setInit] = useState(false)
  const { setSystemFeatures } = useSystemFeaturesStore()

  useEffect(() => {
    getSystemFeatures().then((res) => {
      setSystemFeatures(res)
    }).finally(() => {
      setInit(true)
    })
  }, [])
  return init ? children : null
}

export default SystemFeaturesInitor
