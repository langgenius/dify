'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Float, Environment } from '@react-three/drei'
import { Suspense } from 'react'
import * as THREE from 'three'
import FloatingParticles from './FloatingParticles'
import BambooForest from './BambooForest'

export default function InkScene() {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
      >
        {/* 环境光照 */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} color="#fafaf8" />
        <pointLight position={[-5, 5, -5]} intensity={0.3} color="#7c9885" />

        {/* 雾效 - 营造水墨意境 */}
        <fog attach="fog" args={['#fafaf8', 5, 20]} />

        <Suspense fallback={null}>
          {/* 竹林背景 */}
          <BambooForest />

          {/* 漂浮粒子 */}
          <FloatingParticles count={50} />

          {/* 环境贴图 */}
          <Environment preset="dawn" />
        </Suspense>

        {/* 轨道控制器 - 可选，用于调试 */}
        {/* <OrbitControls enableZoom={false} enablePan={false} /> */}
      </Canvas>
    </div>
  )
}
