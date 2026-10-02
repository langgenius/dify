'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

// 动态加载3D场景，禁用SSR
const InkScene = dynamic(() => import('@/components/three/InkScene'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen bg-paper-white flex items-center justify-center">
      <div className="text-ink-grey">加载中...</div>
    </div>
  ),
})

export default function Home() {
  return (
    <main className="relative w-full h-screen overflow-hidden">
      {/* 3D水墨背景 */}
      <Suspense fallback={<div className="w-full h-screen bg-paper-white" />}>
        <InkScene />
      </Suspense>

      {/* 主要内容 */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
        {/* Logo和公司信息 */}
        <div className="text-center space-y-8">
          {/* Logo占位 */}
          <div className="flex flex-col items-center space-y-4">
            <div className="w-32 h-32 rounded-full bg-bamboo-green/10 flex items-center justify-center">
              <span className="text-4xl font-serif text-bamboo-green">言李</span>
            </div>
          </div>

          {/* 公司名称 */}
          <div className="space-y-2">
            <h1 className="text-5xl font-serif text-ink-black tracking-wider">
              言李AI智能体平台
            </h1>
            <p className="text-xl text-ink-grey font-sans">
              北京言李科技有限公司
            </p>
            <p className="text-sm text-ink-light font-en">
              Beijing Yanli Technology Co., Ltd.
            </p>
          </div>

          {/* CTA按钮 */}
          <div className="flex gap-6 justify-center pt-8">
            <button className="px-8 py-3 bg-bamboo-green text-white rounded-yanli hover:shadow-ink transition-all duration-300">
              开始使用
            </button>
            <button className="px-8 py-3 border-2 border-bamboo-green text-bamboo-green rounded-yanli hover:bg-bamboo-green/5 transition-all duration-300">
              了解更多
            </button>
          </div>
        </div>

        {/* 底部版权信息 */}
        <div className="absolute bottom-8 text-sm text-ink-light">
          © 2024 北京言李科技有限公司 Beijing Yanli Technology Co., Ltd.
        </div>
      </div>
    </main>
  )
}
