## Three.js 在唐宋美学中的应用

### 1. 核心视觉效果

#### 1.1 水墨渲染效果
```typescript
// 使用Three.js实现水墨渲染
- 粒子系统：模拟墨水在宣纸上的晕染效果
- Shader材质：自定义着色器实现水墨质感
- 后期处理：添加边缘检测和黑白滤镜
```

#### 1.2 首页3D场景
- **竹林意境**: 3D竹林背景，随鼠标轻微摆动
- **漂浮粒子**: 模拟飞絮或墨点，营造空灵感
- **水墨云雾**: 动态雾效，增强纵深感
- **光影变化**: 柔和的环境光，随时间变化

#### 1.3 交互动画
- **鼠标跟随**: 水墨笔触跟随鼠标轨迹
- **点击涟漪**: 点击产生水墨晕染动画
- **页面切换**: 水墨过渡效果
- **卡片悬浮**: 3D卡片翻转和浮动

### 2. Three.js技术栈

```json
"dependencies": {
  "three": "^0.160.0",
  "@react-three/fiber": "^8.15.0",
  "@react-three/drei": "^9.92.0",
  "@react-three/postprocessing": "^2.16.0",
  "postprocessing": "^6.34.0",
  "maath": "^0.10.0",
  "leva": "^0.9.35"
}
```

### 3. 应用场景

#### 3.1 登录页面
```tsx
<Canvas>
  <InkScene />
  <FloatingParticles count={100} />
  <LoginForm />
</Canvas>
```
- 3D水墨背景
- 粒子系统营造氛围
- 登录表单浮于3D场景之上

#### 3.2 首页Dashboard
```tsx
<Canvas>
  <BambooForest />
  <FogEffect />
  <StatsCards3D />
</Canvas>
```
- 竹林3D场景
- 数据卡片3D悬浮
- 鼠标交互效果

#### 3.3 知识库可视化
```tsx
<Canvas>
  <KnowledgeGraph3D nodes={knowledge} />
  <OrbitControls />
</Canvas>
```
- 3D知识图谱
- 节点连线动画
- 可旋转查看

#### 3.4 聊天界面装饰
```tsx
<div className="relative">
  <Canvas className="absolute inset-0 -z-10">
    <FloatingInk />
  </Canvas>
  <ChatMessages />
</div>
```
- 背景水墨装饰
- 不影响主要内容
- 增强视觉美感

### 4. 性能优化策略

#### 4.1 懒加载
```tsx
const InkScene = dynamic(() => import('@/components/three/InkScene'), {
  ssr: false,
  loading: () => <div className="bg-paper-white" />
})
```

#### 4.2 LOD（Level of Detail）
- 根据设备性能调整粒子数量
- 低配设备降低渲染质量
- 移动端简化3D效果

#### 4.3 条件渲染
```tsx
const use3D = useMediaQuery('(min-width: 1024px)') && !isMobile;

{use3D ? <InkScene3D /> : <InkBackground2D />}
```

### 5. 水墨Shader示例

```glsl
// 水墨质感片段着色器
varying vec2 vUv;
uniform float uTime;
uniform sampler2D uTexture;

void main() {
  vec2 uv = vUv;
  
  // 添加噪声模拟宣纸纹理
  float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  
  // 水墨晕染效果
  vec4 color = texture2D(uTexture, uv);
  color.rgb *= 0.95 + noise * 0.05;
  
  // 边缘虚化
  float vignette = 1.0 - length(uv - 0.5) * 0.5;
  color.rgb *= vignette;
  
  gl_FragColor = color;
}
```

### 6. 组件架构

```
components/three/
├── InkScene/
│   ├── index.tsx              # 主场景
│   ├── InkShader.ts           # 水墨着色器
│   └── InkMaterial.tsx        # 水墨材质
├── BambooForest/
│   ├── index.tsx              # 竹林场景
│   ├── Bamboo.tsx             # 单根竹子
│   └── Wind.tsx               # 风力系统
├── FloatingParticles/
│   ├── index.tsx              # 粒子系统
│   └── Particle.tsx           # 单个粒子
└── effects/
    ├── InkPostProcessing.tsx  # 后期处理
    └── FogEffect.tsx          # 雾效
```

---

## 更新后的package.json

```json
{
  "name": "yanli-ai-agent",
  "version": "1.0.0",
  "private": true,
  "description": "言李AI智能体平台 - 前端应用",
  "author": "Beijing Yanli Technology Co., Ltd.",
  "license": "PROPRIETARY",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    
    "three": "^0.160.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.92.0",
    "@react-three/postprocessing": "^2.16.0",
    "postprocessing": "^6.34.0",
    "maath": "^0.10.0",
    
    "zustand": "^4.5.0",
    "jotai": "^2.6.0",
    "ky": "^1.7.0",
    "dayjs": "^1.11.10",
    "clsx": "^2.1.0",
    "react-i18next": "^14.0.0",
    "i18next": "^23.7.0",
    "zod": "^3.22.4",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/react": "^18.2.45",
    "@types/react-dom": "^18.2.18",
    "@types/three": "^0.160.0",
    "@types/uuid": "^9.0.7",
    "typescript": "^5.3.3",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.32",
    "autoprefixer": "^10.4.16",
    "eslint": "^8.56.0",
    "eslint-config-next": "^15.0.0"
  }
}
```
