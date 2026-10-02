# 言李AI智能体平台 - 前端

## 项目简介

基于Dify后端API，全新设计的唐宋美学风格前端应用。采用Three.js打造沉浸式3D水墨意境。

**公司**: 北京言李科技有限公司 / Beijing Yanli Technology Co., Ltd.

## 技术栈

- **框架**: Next.js 15 + React 19
- **3D渲染**: Three.js + React Three Fiber
- **样式**: TailwindCSS
- **状态管理**: Zustand + Jotai
- **HTTP客户端**: Ky
- **类型检查**: TypeScript

## 设计特色

- 🎨 **唐宋美学**: 水墨色系、宋体字、留白设计
- 🌿 **3D竹林场景**: 使用Three.js渲染动态竹林背景
- ✨ **水墨粒子**: 漂浮粒子营造空灵意境
- 🎭 **交互动画**: 鼠标跟随、点击涟漪效果
- 📱 **响应式设计**: 适配桌面和移动设备

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
cd web-yanli
pnpm install
```

### 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local` 配置后端API地址：

```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

### 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000

### 构建生产版本

```bash
pnpm build
pnpm start
```

## 项目结构

```
web-yanli/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # 根布局
│   │   ├── page.tsx            # 首页
│   │   └── globals.css         # 全局样式
│   ├── components/
│   │   ├── three/              # Three.js组件
│   │   │   ├── InkScene.tsx    # 水墨场景
│   │   │   ├── BambooForest.tsx # 竹林
│   │   │   └── FloatingParticles.tsx # 粒子
│   │   ├── ui/                 # UI组件
│   │   └── layout/             # 布局组件
│   ├── services/               # API服务
│   ├── stores/                 # 状态管理
│   └── utils/                  # 工具函数
├── public/                     # 静态资源
├── package.json
├── next.config.js
├── tailwind.config.js
└── tsconfig.json
```

## API对接

本前端项目完全依赖Dify后端API，主要接口包括：

- **认证**: `/api/login`, `/api/logout`
- **知识库**: `/api/datasets`, `/api/datasets/:id/documents`
- **问答**: `/api/chat-messages`, `/api/conversations`
- **公文**: `/api/completion-messages`, `/api/documents`

## 开发指南

### 添加新页面

1. 在 `src/app/` 下创建路由文件夹
2. 添加 `page.tsx` 和 `layout.tsx`
3. 使用唐宋美学组件库

### 自定义Three.js场景

1. 在 `src/components/three/` 创建新组件
2. 使用 `@react-three/fiber` 和 `@react-three/drei`
3. 保持水墨意境风格

### 样式规范

- 使用Tailwind工具类
- 颜色：`bamboo-green`, `ink-black`, `paper-white`
- 圆角：`rounded-yanli` (8px)
- 阴影：`shadow-yanli`

## 性能优化

- ✅ 3D场景动态加载（`dynamic import`）
- ✅ 禁用SSR渲染Three.js组件
- ✅ 根据设备性能调整粒子数量
- ✅ 移动端降级为2D背景

## 浏览器支持

- Chrome >= 90
- Firefox >= 88
- Safari >= 14
- Edge >= 90

## 许可证

专有软件 - 北京言李科技有限公司

## 联系方式

北京言李科技有限公司  
Beijing Yanli Technology Co., Ltd.

---

© 2024 北京言李科技有限公司 版权所有
