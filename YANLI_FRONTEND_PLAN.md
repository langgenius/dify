# 言李AI智能体平台 - 前端改造方案

## 项目信息

- **分支名称**: ylai-agent-sys
- **公司**: 北京言李科技有限公司 / Beijing Yanli Technology Co., Ltd.
- **设计风格**: 唐宋美学 + 现代简约
- **技术栈**: React + Next.js + TypeScript

---

## 一、设计理念

### 1.1 唐宋美学元素

**核心原则**: 师法自然，留白为美，克制而雅致

**视觉语言**
- **色彩**: 水墨灰度 + 文人雅色（青、竹、墨、宣）
- **字体**: 现代宋体（思源宋体）+ 无衬线辅助字体
- **留白**: 充分的空间感，避免信息过载
- **线条**: 简洁的笔触感，细线勾勒
- **意境**: 清幽雅致，不张扬

### 1.2 色彩方案（唐宋意境）

```css
/* 主色调 - 水墨系 */
--ink-black: #1a1a1a;        /* 浓墨 */
--ink-grey: #4a4a4a;         /* 淡墨 */
--paper-white: #fafaf8;      /* 宣纸白 */
--mist-grey: #e8e8e6;        /* 烟雾灰 */

/* 点缀色 - 文人雅色 */
--bamboo-green: #7c9885;     /* 竹青 */
--pine-green: #5a7363;       /* 松绿 */
--clay-red: #b7817a;         /* 朱砂红（点睛之笔） */
--sky-blue: #a8c5d1;         /* 天青色 */

/* 功能色 */
--success: #7c9885;          /* 竹青 - 成功 */
--warning: #d4a574;          /* 姜黄 - 警告 */
--error: #b7817a;            /* 朱砂 - 错误 */
--info: #a8c5d1;             /* 天青 - 信息 */
```

### 1.3 字体系统

```css
/* 主标题 - 宋体 */
font-family: 'Source Han Serif CN', 'Noto Serif SC', serif;

/* 正文 - 无衬线 */
font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;

/* 英文/数字 */
font-family: 'Inter', 'SF Pro Display', sans-serif;
```

---

## 二、技术架构

### 2.1 技术栈选型

| 层级 | 技术 | 说明 |
|-----|------|------|
| **框架** | Next.js 15 | 服务端渲染 + 静态生成 |
| **UI库** | React 19 | 组件化开发 |
| **3D渲染** | Three.js + React Three Fiber | 3D场景渲染，打造水墨意境 |
| **3D工具库** | @react-three/drei | Three.js辅助工具 |
| **3D后期** | @react-three/postprocessing | 后期效果（水墨渲染） |
| **状态管理** | Zustand + Jotai | 轻量级状态管理 |
| **样式** | TailwindCSS + CSS Modules | 原子化CSS + 模块化 |
| **请求库** | Ky | 基于fetch的HTTP客户端 |
| **图标** | 自定义SVG + Remix Icon | 符合美学的图标系统 |

### 2.2 目录结构（新前端）

```
web-yanli/                      # 新前端项目
├── public/                     # 静态资源
│   ├── logo-yanli.svg         # 言李科技Logo
│   ├── favicon.ico
│   └── fonts/                 # 字体文件
│       ├── SourceHanSerif/    # 思源宋体
│       └── Inter/             # Inter字体
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── layout.tsx         # 根布局
│   │   ├── page.tsx           # 首页（3D水墨场景）
│   │   ├── (auth)/            # 认证相关
│   │   ├── (dashboard)/       # 主控制台
│   │   ├── (knowledge)/       # 知识库
│   │   ├── (chat)/            # 智能问答
│   │   └── (document)/        # 公文写作
│   ├── components/            # 组件库
│   │   ├── ui/                # 基础UI组件
│   │   │   ├── Button/
│   │   │   ├── Input/
│   │   │   ├── Card/
│   │   │   └── ...
│   │   ├── three/             # Three.js 3D组件
│   │   │   ├── InkScene/      # 水墨场景
│   │   │   ├── BambooForest/  # 竹林背景
│   │   │   ├── FloatingParticles/ # 漂浮粒子
│   │   │   └── InkEffect/     # 水墨效果
│   │   ├── layout/            # 布局组件
│   │   │   ├── Header/
│   │   │   ├── Sidebar/
│   │   │   └── Footer/
│   │   └── business/          # 业务组件
│   ├── services/              # API服务
│   │   ├── api/               # API调用封装
│   │   │   ├── auth.ts
│   │   │   ├── knowledge.ts
│   │   │   ├── chat.ts
│   │   │   └── document.ts
│   │   └── client.ts          # HTTP客户端配置
│   ├── stores/                # 状态管理
│   │   ├── auth.ts
│   │   ├── knowledge.ts
│   │   └── chat.ts
│   ├── hooks/                 # 自定义Hooks
│   ├── utils/                 # 工具函数
│   ├── types/                 # TypeScript类型
│   ├── styles/                # 全局样式
│   │   ├── globals.css
│   │   ├── yanli-theme.css    # 言李主题
│   │   └── typography.css     # 字体排版
│   └── constants/             # 常量定义
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 三、核心功能模块

### 3.1 认证模块 (Auth)

**页面**
- `/login` - 登录页（水墨风格）
- `/register` - 注册页
- `/forgot-password` - 忘记密码

**API对接**
- `POST /api/login` - 用户登录
- `POST /api/logout` - 用户登出
- `GET /api/user/profile` - 获取用户信息

### 3.2 知识库模块 (Knowledge)

**页面**
- `/knowledge` - 知识库首页
- `/knowledge/:id` - 知识库详情
- `/knowledge/:id/upload` - 文件上传
- `/knowledge/:id/qa` - 问答对管理

**API对接**
- `GET /api/datasets` - 获取知识库列表
- `POST /api/datasets` - 创建知识库
- `POST /api/datasets/:id/documents` - 上传文档
- `GET /api/datasets/:id/documents` - 获取文档列表

### 3.3 智能问答模块 (Chat)

**页面**
- `/chat` - 问答首页
- `/chat/:session_id` - 对话会话

**API对接**
- `POST /api/chat-messages` - 发送消息
- `GET /api/conversations` - 获取会话列表
- `GET /api/conversations/:id/messages` - 获取消息历史

### 3.4 公文写作模块 (Document)

**页面**
- `/document` - 公文写作首页
- `/document/generate` - 智能生成
- `/document/edit/:id` - 编辑器

**API对接**
- `POST /api/completion-messages` - 文本生成
- `POST /api/documents` - 保存公文
- `GET /api/documents` - 获取公文列表

---

## 四、设计组件库

### 4.1 基础组件（唐宋风格）

#### Button - 按钮
```tsx
// 样式特点：细边框，圆角8px，点击有水墨晕染效果
<Button variant="primary">主要按钮</Button>
<Button variant="ghost">次要按钮</Button>
```

#### Card - 卡片
```tsx
// 样式特点：轻微阴影，留白充足，边框淡雅
<Card>
  <Card.Header>标题</Card.Header>
  <Card.Content>内容</Card.Content>
</Card>
```

#### Input - 输入框
```tsx
// 样式特点：底部细线，聚焦时水墨色加深
<Input placeholder="请输入..." />
<TextArea placeholder="请输入..." />
```

### 4.2 业务组件

#### KnowledgeTree - 知识库树形结构
```tsx
// 三级结构：单位级 > 部门级 > 个人级
<KnowledgeTree
  data={knowledgeData}
  onSelect={handleSelect}
/>
```

#### ChatWindow - 聊天窗口
```tsx
// 简洁的对话界面，支持文字/图片/视频展示
<ChatWindow
  messages={messages}
  onSend={handleSend}
/>
```

#### DocumentEditor - 公文编辑器
```tsx
// 所见即所得编辑器，支持公文模板
<DocumentEditor
  template="notice"
  onSave={handleSave}
/>
```

---

## 五、Logo与品牌设计

### 5.1 Logo设计概念

**设计元素**
- **言**: 简化的"言"字，采用宋体笔画
- **李**: 简化的"李"字，融入科技线条
- **组合**: 上下结构，体现传统与现代的融合
- **配色**: 墨黑主体 + 竹青点缀

**Logo规范**
- 主Logo: SVG格式，支持深色/浅色模式
- 尺寸: 标准版 200x60px，小图标 48x48px
- 位置: 左上角，搭配公司中英文名称

### 5.2 品牌信息展示

```tsx
// Header组件中的Logo
<Header>
  <Logo />
  <CompanyName>
    <span className="zh">北京言李科技有限公司</span>
    <span className="en">Beijing Yanli Technology Co., Ltd.</span>
  </CompanyName>
</Header>

// Footer版权信息
<Footer>
  <Copyright>
    © 2024 北京言李科技有限公司 Beijing Yanli Technology Co., Ltd.
  </Copyright>
</Footer>
```

---

## 六、实施步骤

### 第一阶段：项目初始化（1-2天）

1. ✅ 创建新分支 `ylai-agent-sys`
2. 创建新前端目录 `web-yanli/`
3. 初始化Next.js项目
4. 配置TailwindCSS + 唐宋主题
5. 引入字体文件（思源宋体 + Inter）

### 第二阶段：基础组件开发（3-5天）

1. 开发UI组件库（Button, Input, Card等）
2. 实现布局组件（Header, Sidebar, Footer）
3. 配置路由结构
4. 实现主题切换功能

### 第三阶段：API对接（3-5天）

1. 配置HTTP客户端
2. 封装Dify后端API
3. 实现认证流程
4. 测试API连通性

### 第四阶段：核心功能开发（7-10天）

1. 知识库模块
2. 智能问答模块
3. 公文写作模块
4. 权限管理模块

### 第五阶段：测试与优化（3-5天）

1. 功能测试
2. 性能优化
3. 响应式适配
4. 浏览器兼容性测试

---

## 七、关键技术要点

### 7.1 Dify后端API对接

**API Base URL配置**
```typescript
// src/services/client.ts
export const apiClient = ky.create({
  prefixUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  hooks: {
    beforeRequest: [
      request => {
        const token = getAuthToken();
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      }
    ]
  }
});
```

### 7.2 唐宋美学CSS实现

**水墨渐变效果**
```css
.ink-gradient {
  background: linear-gradient(
    to bottom,
    rgba(26, 26, 26, 0.05),
    rgba(26, 26, 26, 0.02)
  );
}

/* 按钮水墨晕染效果 */
.button-ink:hover {
  box-shadow: 
    0 0 0 4px rgba(124, 152, 133, 0.1),
    0 0 0 8px rgba(124, 152, 133, 0.05);
  transition: box-shadow 0.3s ease;
}
```

### 7.3 响应式设计

**断点定义**
```javascript
// tailwind.config.ts
screens: {
  'sm': '640px',   // 手机
  'md': '768px',   // 平板
  'lg': '1024px',  // 小屏笔记本
  'xl': '1280px',  // 桌面
  '2xl': '1536px', // 大屏
}
```

---

## 八、后续优化方向

1. **国际化**: 支持中英文切换
2. **暗色模式**: 适配深色唐宋主题
3. **无障碍**: WCAG 2.1 AA级别
4. **性能优化**: 懒加载、代码分割
5. **移动端**: 响应式 + PWA支持

---

**文档版本**: v1.0  
**创建日期**: 2026-10-02  
**维护团队**: 北京言李科技有限公司
