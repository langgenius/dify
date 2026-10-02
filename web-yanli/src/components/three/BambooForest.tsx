'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// 单根竹子组件
function Bamboo({ position }: { position: [number, number, number] }) {
  const bambooRef = useRef<THREE.Group>(null)

  // 竹子随风轻微摆动
  useFrame((state) => {
    if (!bambooRef.current) return

    const time = state.clock.getElapsedTime()
    bambooRef.current.rotation.z = Math.sin(time + position[0]) * 0.02
  })

  return (
    <group ref={bambooRef} position={position}>
      {/* 竹竿 */}
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 4, 8]} />
        <meshStandardMaterial color="#5a7363" roughness={0.8} />
      </mesh>

      {/* 竹节 */}
      {[0.5, 1.5, 2.5, 3.5].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <cylinderGeometry args={[0.11, 0.11, 0.15, 8]} />
          <meshStandardMaterial color="#4a6353" roughness={0.9} />
        </mesh>
      ))}

      {/* 竹叶 */}
      {[...Array(6)].map((_, i) => {
        const angle = (i / 6) * Math.PI * 2
        const x = Math.cos(angle) * 0.3
        const z = Math.sin(angle) * 0.3
        return (
          <mesh
            key={i}
            position={[x, 3.8 + Math.random() * 0.3, z]}
            rotation={[0, angle, Math.PI / 6]}
          >
            <planeGeometry args={[0.15, 0.6]} />
            <meshStandardMaterial
              color="#7c9885"
              side={THREE.DoubleSide}
              transparent
              opacity={0.9}
            />
          </mesh>
        )
      })}
    </group>
  )
}

// 竹林场景
export default function BambooForest() {
  // 生成竹林位置
  const bambooPositions: [number, number, number][] = []

  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * 15
    const z = (Math.random() - 0.5) * 15 - 5
    bambooPositions.push([x, 0, z])
  }

  return (
    <group>
      {bambooPositions.map((pos, i) => (
        <Bamboo key={i} position={pos} />
      ))}

      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial
          color="#e8e8e6"
          roughness={1}
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  )
}
