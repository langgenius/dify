'use client'

import { basePath } from '@/utils/var'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function RoutePrefixHandle() {
  const pathname = usePathname()
  console.log('basePath:', basePath)
  const handleRouteChange = () => {
    console.log('已切换到:', pathname)
    const addPrefixToImg = (e) => {
      const url = new URL(e.src)
      const prefix = url.pathname.substr(0, basePath.length)
      if (prefix !== basePath) {
        url.pathname = basePath + url.pathname
        e.src = url.toString()
      }
    }
    // 创建一个观察者实例
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          // 监听新增的 img 标签
          mutation.addedNodes.forEach((node) => {
            if (node.tagName === 'IMG')
              addPrefixToImg(node)
          })
        }
        else if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG') {
          // 如果已有 img 标签的 src 发生变化，更新前缀
          if (mutation.attributeName === 'src')
            addPrefixToImg(mutation.target)
        }
      }
    })

    // 配置观察选项
    const config = {
      childList: true, // 监听子节点变化
      attributes: true, // 监听属性变化
      subtree: true, // 监听整个子树
      attributeFilter: ['src'], // 只监听 src 属性
    }

    observer.observe(document.body, config)
  }

  useEffect(() => {
    if (basePath)
      handleRouteChange()
  }, [pathname])

  return null
}
