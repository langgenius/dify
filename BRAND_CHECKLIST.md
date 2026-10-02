# 品牌改造检查清单

## 🎯 快速定位：主要品牌出现位置

### 高优先级（用户直接可见）

#### 前端 UI
- [ ] 登录页面标题和 Logo
- [ ] 主导航栏 Logo
- [ ] 页面标题（浏览器标签）
- [ ] 关于/版本信息弹窗
- [ ] 帮助文档链接文本

#### i18n 关键文件
```bash
# 简体中文
web/i18n/zh-Hans/common.json
  - about.latestAvailable (版本更新提示)
  - about.nowAvailable (版本可用提示)
  - mainNav.help.learnDify (导航菜单)
  - stepByStepTour.* (新手引导)

web/i18n/zh-Hans/app-overview.json
  - apiKeyInfo.tryCloud (云服务推荐)
```

#### Logo 文件位置
```
web/public/logo/
├── logo.svg                           # 主 Logo (SVG)
├── logo-site.png                      # 网站 Logo (亮色)
├── logo-site-dark.png                 # 网站 Logo (暗色)
├── logo-embedded-chat-avatar.png      # 聊天头像
├── logo-embedded-chat-header.png      # 聊天头部
├── logo-embedded-chat-header@2x.png   # 高清版本
└── logo-embedded-chat-header@3x.png   # 超高清版本
```

### 中优先级（配置和元数据）

#### Package 配置
- [ ] `web/package.json` - "name": "dify-web"
- [ ] `package.json` (根目录) - 如果有的话
- [ ] `api/pyproject.toml` 或 `setup.py` - Python 包名

#### 版权和许可
- [ ] `LICENSE` - 版权所有者
- [ ] 代码文件头部版权声明（如果有）

#### 文档
- [ ] `README.md` - 主要产品介绍
- [ ] `CONTRIBUTING.md` - 贡献指南中的品牌引用
- [ ] `docs/` 各语言文档

### 低优先级（开发者可见）

#### 后端代码
- [ ] `api/app.py:45` - 日志："Serving Dify API"
- [ ] 其他服务文件中的日志和注释

#### Docker
- [ ] `docker/README.md`
- [ ] Docker Compose 文件注释

## 📝 搜索命令速查

### 搜索所有 "Dify" 引用
```bash
# 前端 i18n
grep -r "Dify" web/i18n/ --include="*.json"

# 前端代码
grep -r "Dify" web/ --include="*.ts" --include="*.tsx" --exclude-dir=node_modules

# 后端代码
grep -r "Dify" api/ --include="*.py"

# 文档
grep -r "Dify" . --include="*.md" --exclude-dir=node_modules --exclude-dir=.git

# 配置文件
grep -r "dify" . --include="*.json" --include="*.yaml" --include="*.yml" --exclude-dir=node_modules
```

### 统计引用数量
```bash
grep -r "Dify" web/i18n/zh-Hans/*.json | wc -l
grep -r "Dify" api/ --include="*.py" | wc -l
```

## 🔄 替换策略

### 方案 A：保守方案（推荐）
保留技术层面的引用，只替换用户可见部分：
- ✅ 替换所有 UI 文本
- ✅ 替换所有 Logo
- ✅ 更新版权信息
- ❌ 保留代码内部变量名（如 dify_app.py）
- ❌ 保留日志中的技术标识

**优点**：
- 减少改动范围，降低风险
- 便于后续合并上游更新
- 技术债务更少

### 方案 B：彻底方案
完全移除所有 "Dify" 痕迹：
- ✅ 替换所有文本、Logo、版权
- ✅ 重命名文件（dify_app.py → yanli_app.py）
- ✅ 修改所有日志和注释
- ✅ 更改 Python 包名和模块名

**优点**：
- 品牌完全独立
- 无任何遗留引用

**缺点**：
- 改动大，测试工作量大
- 难以合并上游更新
- 可能引入意外 bug

## 💡 实施建议

### 1. 先准备资产
- [ ] 新 Logo (SVG + PNG 多尺寸)
- [ ] 新产品名称（中英文）
- [ ] 公司联系信息
- [ ] 确定许可证策略

### 2. 分阶段替换
1. **第一批**：Logo + i18n（用户直接可见）
2. **第二批**：LICENSE + README（法律和介绍）
3. **第三批**：代码层面（如果选择方案 B）

### 3. 每批替换后测试
```bash
# 启动服务
./start-dify.sh restart

# 检查前端
open http://localhost

# 检查 API
curl http://localhost/api/version
```

### 4. 版本控制
```bash
# 每完成一批，创建一个 commit
git add .
git commit -m "品牌改造: 第一批 - Logo和i18n"

# 创建标签
git tag rebranding-phase-1
```

## 🚨 风险提示

1. **许可证合规性**
   - Dify 的 LICENSE 明确禁止移除前端 Logo 和版权
   - 需要商业许可才能合法移除品牌
   - 建议：咨询法律顾问或联系 LangGenius

2. **技术风险**
   - 大规模重命名可能破坏导入关系
   - 数据库表名、API 端点如有 "dify" 字样需谨慎
   - 第三方集成可能依赖特定命名

3. **维护成本**
   - 品牌改造后难以合并上游更新
   - 需要自行维护所有功能和安全补丁

## ✅ 验收标准

### 前端检查
- [ ] 所有页面不显示 "Dify" 文字
- [ ] 所有 Logo 已替换
- [ ] 页面标题显示新品牌名
- [ ] 关于页面显示正确版权信息
- [ ] 帮助链接指向新文档

### 后端检查
- [ ] API 响应中无 "Dify" 品牌
- [ ] 版本接口返回新产品名
- [ ] 日志文件可接受（取决于选择的方案）

### 文档检查
- [ ] README 介绍新产品
- [ ] LICENSE 显示正确版权
- [ ] 文档链接有效

### 法律检查
- [ ] 新许可证明确权利归属
- [ ] 是否需要保留原始许可证声明（取决于法律建议）
- [ ] 第三方依赖的许可证兼容性

---

**注意**: 这是一个指导性文档，具体实施前请：
1. 获取法律建议
2. 确认技术方案
3. 准备完整的品牌资产
4. 制定回滚计划
