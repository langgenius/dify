# Clickzetta Lakehouse & Dify 集成方案

## 项目关系

本目录包含Clickzetta Lakehouse与Dify集成的两种方案：

### 1. 核心向量数据库集成 (当前目录)
- **位置**: `/Users/liangmo/Documents/GitHub/dify/clickzetta/`
- **类型**: Dify核心功能集成
- **用途**: 将Clickzetta Lakehouse作为Dify的底层向量数据库
- **目标用户**: Dify部署管理员
- **文档**: `CLICKZETTA_VECTOR_DB_GUIDE.md`

### 2. 插件工具集成 (独立项目)
- **位置**: `/Users/liangmo/Documents/GitHub/clickzetta_dify/`
- **类型**: Dify插件工具
- **用途**: 提供Clickzetta相关的工具供Dify工作流使用
- **目标用户**: Dify应用开发者
- **GitHub**: https://github.com/yunqiqiliang/clickzetta_dify
- **文档**: 插件项目中的`docs/CLICKZETTA_PLUGIN_INSTALLATION_GUIDE.md`

## 使用场景对比

| 特性 | 核心集成 | 插件工具 |
|------|----------|----------|
| **安装方式** | 配置环境变量 | 安装插件包 |
| **使用对象** | Dify系统管理员 | Dify应用开发者 |
| **功能范围** | 底层向量存储 | 工作流工具 |
| **配置复杂度** | 中等 | 简单 |
| **适用场景** | 替换默认向量数据库 | 灵活的数据操作 |

## 推荐使用方案

### 场景1: 企业级部署
- **使用**: 核心向量数据库集成
- **优势**: 统一的数据存储，更好的性能和管理
- **配置**: 参考 `CLICKZETTA_VECTOR_DB_GUIDE.md`

### 场景2: 应用开发
- **使用**: 插件工具集成
- **优势**: 灵活的工具使用，无需系统级配置
- **配置**: 参考插件项目的安装指南

### 场景3: 混合使用
- **使用**: 同时使用两种方案
- **优势**: 既有统一的底层存储，又有灵活的工具操作
- **注意**: 确保两种方案使用相同的Clickzetta实例和配置

## 快速开始

### 核心集成配置
```bash
# 设置环境变量
export VECTOR_STORE=clickzetta
export CLICKZETTA_USERNAME=your_username
export CLICKZETTA_PASSWORD=your_password
export CLICKZETTA_INSTANCE=your_instance
# ... 其他配置

# 重启Dify服务
docker-compose restart
```

### 插件工具安装
1. 从GitHub下载插件包
2. 在Dify中安装插件
3. 配置连接信息
4. 在工作流中使用工具

详细说明请参考各自的文档。