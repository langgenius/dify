# 任务列表

- [x] 任务 1：将 `login_dg.png` 复制到 `/web/public/logo/login_dg.png`
  - 将项目根目录下的图片文件复制到 public logo 目录。

- [x] 任务 2：更新 `dify-logo.tsx` 组件使用新 Logo
  - 2.1：简化 `logoPathMap` — `default` 和 `monochromeWhite` 两个样式都指向 `/logo/login_dg.png`
  - 2.2：移除主题感知的样式切换逻辑（`useTheme` 导入和 `themedStyle` 计算），因为单张 PNG 即可处理两种主题

- [x] 任务 3：更新 `logo-site.tsx` 组件
  - 将 `src` 从 `/logo/logo.png` 改为 `/logo/login_dg.png`

- [x] 任务 4：更新 `logo-embedded-chat-header.tsx` 组件
  - 将 `<picture>` 元素（包含 1x/2x/3x 的 `<source>` 标签）替换为简单的 `<img src="/logo/login_dg.png">`

- [x] 任务 5：更新 `logo-embedded-chat-avatar.tsx` 组件
  - 将 `src` 从 `/logo/logo-embedded-chat-avatar.png` 改为 `/logo/login_dg.png`

- [x] 任务 6：更新所有后端邮件模板
  - 6.1：搜索 `/api/templates/` 下所有 HTML 模板中出现的 `https://assets.dify.ai/images/logo.png`
  - 6.2：将每个出现位置替换为 `https://assets.dify.ai/images/login_dg.png`
  - 6.3：适用于所有子目录（包括 `/api/templates/without-brand/`）

- [x] 任务 7：更新测试
  - 7.1：更新 `dify-logo.spec.tsx` 测试，反映简化后的组件（不再有主题切换）
  - 7.2：更新 `logo-site.spec.tsx` 测试
  - 7.3：更新 `logo-embedded-chat-header.spec.tsx` 测试
  - 7.4：更新 `logo-embedded-chat-avatar.spec.tsx` 测试

# 任务依赖关系

- 任务 1 必须在任务 2–5 之前完成（组件需要文件存在）
- 任务 2–5 彼此独立（可在任务 1 之后并行执行）
- 任务 6 独立于所有其他任务（可并行执行）
- 任务 7 依赖于任务 2–5（测试必须与组件更改保持一致）
