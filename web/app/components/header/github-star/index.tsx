'use client'
import { useQuery } from '@tanstack/react-query'
import type { FC } from 'react'
import type { GithubRepo } from '@/models/common'
import { RiLoader2Line } from '@remixicon/react'

const defaultData = {
  stargazers_count: 110918,
}

const getStar = async () => {
  const res = await fetch('https://api.github.com/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch github star')

  return res.json()
}

const GithubStar: FC<{ className: string }> = (props) => {
  const { isFetching, isError, data } = useQuery<GithubRepo>({
    queryKey: ['github-star'],
    queryFn: getStar,
    enabled: process.env.NODE_ENV !== 'development',
    retry: false,
    placeholderData: defaultData,
  })

  if (isFetching)
    return <RiLoader2Line className='size-3 shrink-0 animate-spin text-text-tertiary' />

  if (isError)
    return <span {...props}>{defaultData.stargazers_count.toLocaleString()}</span>

  return <span {...props}>{data?.stargazers_count.toLocaleString()}</span>
}

export default GithubStar
