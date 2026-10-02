# 品牌改造计划 - 北京言李科技有限公司

## 概述

将系统从开源 Dify 品牌完全改造为北京言李科技有限公司的专有品牌。

**公司信息**：
- 中文名称：北京言李科技有限公司
- 英文名称：Beijing YanLi Technology Co., Ltd.
- 产品名称：待定（建议提供新的产品名称）

## 改造范围

### 1. 前端界面 (web/)

#### 1.1 Logo 和图标
- [ ] `/web/public/logo/` 目录下所有 logo 文件
  - logo-site.png (当前 Dify logo)
  - logo-site-dark.png
  - logo.svg
  - logo-embedded-chat-avatar.png
  - logo-embedded-chat-header.png (及 @2x, @3x 版本)

#### 1.2 国际化文本 (i18n)
需要修改的主要文件：
- [ ] `web/i18n/zh-Hans/common.json` - 包含约 18 处 "Dify" 引用
  - about.latestAvailable
  - about.nowAvailable
  - apiBasedExtension.title
  - mainNav.help.learnDify
  - stepByStepTour 相关文本
  
- [ ] `web/i18n/zh-Hans/app-overview.json`
- [ ] 其他语言目录 (en-US, ja-JP, etc.) 的对应文件

#### 1.3 Package 配置
- [ ] `web/package.json`
  - name: "dify-web" → "yanli-web"
  - version: 保持或重置

#### 1.4 页面元数据
- [ ] `web/app/layout.tsx` - 应用标题和元数据
- [ ] HTML meta tags, OpenGraph 信息

### 2. 后端服务 (api/)

#### 2.1 Python 代码
- [ ] `api/app.py` - 日志信息 "Serving Dify API"
- [ ] `api/dify_app.py` - 可能需要重命名文件
- [ ] `api/app_factory.py`
- [ ] 其他服务文件中的品牌引用

#### 2.2 API 响应
- [ ] 版本信息接口
- [ ] 系统信息接口
- [ ] 错误消息中的品牌引用

### 3. 许可证和版权

#### 3.1 许可证文件
- [ ] `/LICENSE` - 完全重写
  - 当前：Modified Apache 2.0 with Dify restrictions
  - 新的：北京言李科技有限公司专有许可证
  - 移除 LangGenius, Inc. 版权声明
  - 添加北京言李科技有限公司版权声明

#### 3.2 版权声明
- [ ] 所有源代码文件头部的版权声明
- [ ] README 和文档中的版权信息

### 4. 文档 (docs/)

- [ ] `README.md` - 完全重写产品介绍
- [ ] `CONTRIBUTING.md` - 贡献指南
- [ ] `docs/zh-CN/README.md`
- [ ] 其他语言文档
- [ ] 临时文档：
  - ARCHITECTURE.md
  - QUICKSTART.md
  - DOCKER_INSTALL_GUIDE.md
  - SYNC_GUIDE.md (可能需要删除，因为不再同步上游)

### 5. Docker 配置

- [ ] `docker/README.md`
- [ ] Docker Compose 注释和说明
- [ ] 环境变量说明

### 6. 配置文件

- [ ] 根目录 `package.json`
- [ ] `AGENTS.md` - AI Agent 配置说明
- [ ] 各子项目的配置文件

## 实施步骤

### 阶段 1: 准备工作（当前）
1. ✅ 完成现状分析
2. ✅ 制定改造计划
3. ⏳ **需要用户提供**：
   - 新产品名称（英文/中文）
   - 新 Logo 设计文件（SVG/PNG）
   - 公司官网地址
   - 技术支持联系方式

### 阶段 2: 核心品牌替换
1. 替换所有 Logo 和图标
2. 更新 LICENSE 文件
3. 修改前端 i18n 文本（所有语言）
4. 更新 package.json 名称

### 阶段 3: 代码层面改造
1. 修改后端日志和响应信息
2. 更新 API 文档
3. 修改代码注释中的品牌引用

### 阶段 4: 文档更新
1. 重写 README.md
2. 更新所有用户文档
3. 更新开发者文档

### 阶段 5: 测试验证
1. 前端界面检查（所有页面）
2. API 响应验证
3. 文档完整性检查
4. 版权信息审查

## 法律注意事项

⚠️ **重要**：
1. 原始 Dify 许可证（Modified Apache 2.0）包含特殊条款：
   - 禁止移除前端 LOGO 和版权信息（除非获得商业许可）
   - 禁止多租户商业使用（除非获得授权）

2. **建议**：
   - 确认您的使用场景符合原始许可证要求
   - 如需完全移除 Dify 品牌，建议咨询法律顾问
   - 考虑是否需要联系 LangGenius, Inc. 获取商业许可

3. **合规方案**：
   - 保留原始许可证的副本（重命名为 LICENSE.original）
   - 在新许可证中注明基于 Dify 开源项目
   - 添加北京言李科技的版权覆盖层

## 预估工作量

- **Logo 和静态资源**: 2-4 小时（取决于设计资产准备情况）
- **i18n 文本替换**: 4-6 小时（多语言）
- **代码层面修改**: 6-8 小时
- **文档更新**: 4-6 小时
- **测试验证**: 4-6 小时

**总计**: 20-30 小时

## 下一步行动

请提供以下信息以继续：

1. **新产品名称**（例如：YanLi AI Platform）
2. **Logo 设计**：
   - SVG 格式（用于 web/public/logo/logo.svg）
   - PNG 格式（多个尺寸用于不同场景）
3. **公司信息**：
   - 官网 URL
   - 技术支持邮箱
   - 联系方式
4. **确认是否已获得 Dify 的商业许可** 或 **如何处理原始许可证**

---

**创建时间**: 2026-09-15
**状态**: 等待用户提供品牌资产
