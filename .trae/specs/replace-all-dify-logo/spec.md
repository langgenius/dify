# 替换所有 DifyLogo 图片 规范

## 动机

整个应用中使用的所有 Dify 品牌 Logo 图片（前端 UI、登录页面、嵌入式聊天机器人、邮件模板等）需要替换为新的 Logo 图片（`login_dg.png`），以更新视觉品牌形象。

## 变更内容

- 将 `login_dg.png` 复制到 `/web/public/logo/` 目录下，供前端使用
- 更新主 `DifyLogo` React 组件（`dify-logo.tsx`）使用新图片
- 更新其他 Logo 组件（`LogoSite`、`LogoEmbeddedChatHeader`、`LogoEmbeddedChatAvatar`）使用新图片
- 更新所有前端消费者组件，使其引用新图片
- 更新所有引用 `https://assets.dify.ai/images/logo.png` 的后端邮件模板，指向新 Logo

## 影响范围

- 受影响模块：品牌 Logo 组件、邮件模板、UI 组件
- 受影响代码：`/web/app/components/base/logo/` 下的前端 React 组件，`/web/app/` 下的前端页面，`/api/templates/` 下的邮件模板

## 新增需求

### 需求：将新 Logo 复制到 public 目录

系统应将 `login_dg.png` 从项目根目录复制到 `/web/public/logo/login_dg.png`。

### 需求：更新前端 Logo 组件

四个 Logo React 组件应更新为显示新 Logo 图片：

- **dify-logo.tsx**：将 `logoPathMap` 中 `default` 和 `monochromeWhite` 两个样式都指向 `/logo/login_dg.png`。移除主题感知的样式切换逻辑（`useTheme` 导入和 `themedStyle` 计算），因为新图片是单张 PNG，不需要根据主题切换。
- **logo-site.tsx**：将图片 `src` 从 `/logo/logo.png` 改为 `/logo/login_dg.png`。
- **logo-embedded-chat-header.tsx**：将包含多分辨率（1x/2x/3x）的 `<picture>` 元素替换为简单的 `<img>` 标签，指向 `/logo/login_dg.png`。
- **logo-embedded-chat-avatar.tsx**：将图片 `src` 从 `/logo/logo-embedded-chat-avatar.png` 改为 `/logo/login_dg.png`。

### 需求：更新所有前端消费者组件

所有导入并渲染 `DifyLogo`、`LogoSite`、`LogoEmbeddedChatHeader` 或 `LogoEmbeddedChatAvatar` 的前端组件，无需修改 — 它们将通过更新后的组件自动渲染新 Logo。

### 需求：更新邮件模板

`/api/templates/` 下所有引用 `https://assets.dify.ai/images/logo.png` 的 34 个后端邮件模板，应更新为使用新的 Logo 图片 URL。

#### 场景：邮件模板 Logo 替换

- **当** 邮件模板中引用 `src="https://assets.dify.ai/images/logo.png"`
- **则** `src` 值应替换为 `https://assets.dify.ai/images/login_dg.png`

## 已修改的需求

### 需求：保留旧的 Logo 资源文件

`/web/public/logo/` 下不再被任何组件引用的旧 Logo 文件应保留在原位（不需要删除），以避免破坏外部引用。

## 已移除的需求

（无功能被移除。）
