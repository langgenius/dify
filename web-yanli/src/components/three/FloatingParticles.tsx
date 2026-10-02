'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export default function FloatingParticles({ count = 50 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null)

  // 生成粒子位置
  const particles = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3

      // 随机位置
      positions[i3] = (Math.random() - 0.5) * 20
      positions[i3 + 1] = (Math.random() - 0.5) * 20
      positions[i3 + 2] = (Math.random() - 0.5) * 20

      // 竹青色系
      const colorVariation = 0.8 + Math.random() * 0.2
      colors[i3] = 0.49 * colorVariation // R
      colors[i3 + 1] = 0.6 * colorVariation // G
      colors[i3 + 2] = 0.52 * colorVariation // B
    }

    return { positions, colors }
  }, [count])

  // 动画：粒子缓慢飘动
  useFrame((state) => {
    if (!pointsRef.current) return

    const time = state.clock.getElapsedTime()
    const positions = pointsRef.current.geometry.attributes.position
      .array as Float32Array

    for (let i = 0; i < count; i++) {
      const i3 = i * 3

      // 缓慢上下飘动
      positions[i3 + 1] += Math.sin(time + i) * 0.001

      // 边界检测，循环飘动
      if (positions[i3 + 1] > 10) positions[i3 + 1] = -10
      if (positions[i3 + 1] < -10) positions[i3 + 1] = 10
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true

    // 整体缓慢旋转
    pointsRef.current.rotation.y = time * 0.05
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={particles.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={count}
          array={particles.colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.1}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
