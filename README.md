![cover-v5-optimized](./images/GitHub_README_if.png)

<p align="center">
  📌 <a href="https://dify.ai/blog/introducing-dify-workflow-file-upload-a-demo-on-ai-podcast">Introducing Dify Workflow File Upload: Recreate Google NotebookLM Podcast</a>
</p>

<p align="center">
  <a href="https://cloud.dify.ai">Dify Cloud</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">Self-hosting</a> ·
  <a href="https://docs.dify.ai">Documentation</a> ·
  <a href="https://dify.ai/pricing">Dify edition overview</a>
</p>

<p align="center">
    <a href="https://dify.ai" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/Product-F04438"></a>
    <a href="https://dify.ai/pricing" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/free-pricing?logo=free&color=%20%23155EEF&label=pricing&labelColor=%20%23528bff"></a>
    <a href="https://discord.gg/FngNHpbcY7" target="_blank">
        <img src="https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb"
            alt="chat on Discord"></a>
    <a href="https://reddit.com/r/difyai" target="_blank">  
        <img src="https://img.shields.io/reddit/subreddit-subscribers/difyai?style=plastic&logo=reddit&label=r%2Fdifyai&labelColor=white"
            alt="join Reddit"></a>
    <a href="https://twitter.com/intent/follow?screen_name=dify_ai" target="_blank">
        <img src="https://img.shields.io/twitter/follow/dify_ai?logo=X&color=%20%23f5f5f5"
            alt="follow on X(Twitter)"></a>
    <a href="https://www.linkedin.com/company/langgenius/" target="_blank">
        <img src="https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff"
            alt="follow on LinkedIn"></a>
    <a href="https://hub.docker.com/u/langgenius" target="_blank">
        <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/langgenius/dify-web?labelColor=%20%23FDB062&color=%20%23f79009"></a>
    <a href="https://github.com/langgenius/dify/graphs/commit-activity" target="_blank">
        <img alt="Commits last month" src="https://img.shields.io/github/commit-activity/m/langgenius/dify?labelColor=%20%2332b583&color=%20%2312b76a"></a>
    <a href="https://github.com/langgenius/dify/" target="_blank">
        <img alt="Issues closed" src="https://img.shields.io/github/issues-search?query=repo%3Alanggenius%2Fdify%20is%3Aclosed&label=issues%20closed&labelColor=%20%237d89b0&color=%20%235d6b98"></a>
    <a href="https://github.com/langgenius/dify/discussions/" target="_blank">
        <img alt="Discussion posts" src="https://img.shields.io/github/discussions/langgenius/dify?labelColor=%20%239b8afb&color=%20%237a5af8"></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README_TW.md"><img alt="繁體中文文件" src="https://img.shields.io/badge/繁體中文-d9d9d9"></a>
  <a href="./README_CN.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
  <a href="./README_JA.md"><img alt="日本語のREADME" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
  <a href="./README_ES.md"><img alt="README en Español" src="https://img.shields.io/badge/Español-d9d9d9"></a>
  <a href="./README_FR.md"><img alt="README en Français" src="https://img.shields.io/badge/Français-d9d9d9"></a>
  <a href="./README_KL.md"><img alt="README tlhIngan Hol" src="https://img.shields.io/badge/Klingon-d9d9d9"></a>
  <a href="./README_KR.md"><img alt="README in Korean" src="https://img.shields.io/badge/한국어-d9d9d9"></a>
  <a href="./README_AR.md"><img alt="README بالعربية" src="https://img.shields.io/badge/العربية-d9d9d9"></a>
  <a href="./README_TR.md"><img alt="Türkçe README" src="https://img.shields.io/badge/Türkçe-d9d9d9"></a>
  <a href="./README_VI.md"><img alt="README Tiếng Việt" src="https://img.shields.io/badge/Ti%E1%BA%BFng%20Vi%E1%BB%87t-d9d9d9"></a>
  <a href="./README_DE.md"><img alt="README in Deutsch" src="https://img.shields.io/badge/German-d9d9d9"></a>
  <a href="./README_BN.md"><img alt="README in বাংলা" src="https://img.shields.io/badge/বাংলা-d9d9d9"></a>
</p>

Dify is an open-source LLM app development platform. Its intuitive interface combines agentic AI workflow, RAG pipeline, agent capabilities, model management, observability features, and more, allowing you to quickly move from prototype to production.

## Quick start

> Before installing Dify, make sure your machine meets the following minimum system requirements:
>
> - CPU >= 2 Core
> - RAM >= 4 GiB

</br>

The easiest way to start the Dify server is through [docker compose](docker/docker-compose.yaml). Before running Dify with the following commands, make sure that [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) are installed on your machine:

```bash
cd dify
cd docker
cp .env.example .env
docker compose up -d
```

After running, you can access the Dify dashboard in your browser at [http://localhost/install](http://localhost/install) and start the initialization process.

#### Seeking help

Please refer to our [FAQ](https://docs.dify.ai/getting-started/install-self-hosted/faqs) if you encounter problems setting up Dify. Reach out to [the community and us](#community--contact) if you are still having issues.

> If you'd like to contribute to Dify or do additional development, refer to our [guide to deploying from source code](https://docs.dify.ai/getting-started/install-self-hosted/local-source-code)

## Key features

**1. Workflow**:
Build and test powerful AI workflows on a visual canvas, leveraging all the following features and beyond.

**2. Comprehensive model support**:
Seamless integration with hundreds of proprietary / open-source LLMs from dozens of inference providers and self-hosted solutions, covering GPT, Mistral, Llama3, and any OpenAI API-compatible models. A full list of supported model providers can be found [here](https://docs.dify.ai/getting-started/readme/model-providers).

![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)

**3. Prompt IDE**:
Intuitive interface for crafting prompts, comparing model performance, and adding additional features such as text-to-speech to a chat-based app.

**4. RAG Pipeline**:
Extensive RAG capabilities that cover everything from document ingestion to retrieval, with out-of-box support for text extraction from PDFs, PPTs, and other common document formats.

**5. Agent capabilities**:
You can define agents based on LLM Function Calling or ReAct, and add pre-built or custom tools for the agent. Dify provides 50+ built-in tools for AI agents, such as Google Search, DALL·E, Stable Diffusion and WolframAlpha.

**6. LLMOps**:
Monitor and analyze application logs and performance over time. You could continuously improve prompts, datasets, and models based on production data and annotations.

**7. Backend-as-a-Service**:
All of Dify's offerings come with corresponding APIs, so you could effortlessly integrate Dify into your own business logic.

## Feature Comparison

<table style="width: 100%;">
  <tr>
    <th align="center">Feature</th>
    <th align="center">Dify.AI</th>
    <th align="center">LangChain</th>
    <th align="center">Flowise</th>
    <th align="center">OpenAI Assistants API</th>
  </tr>
  <tr>
    <td align="center">Programming Approach</td>
    <td align="center">API + App-oriented</td>
    <td align="center">Python Code</td>
    <td align="center">App-oriented</td>
    <td align="center">API-oriented</td>
  </tr>
  <tr>
    <td align="center">Supported LLMs</td>
    <td align="center">Rich Variety</td>
    <td align="center">Rich Variety</td>
    <td align="center">Rich Variety</td>
    <td align="center">OpenAI-only</td>
  </tr>
  <tr>
    <td align="center">RAG Engine</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">Agent</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">Workflow</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Observability</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Enterprise Feature (SSO/Access control)</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Local Deployment</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
</table>

## Using Dify

- **Cloud </br>**
  We host a [Dify Cloud](https://dify.ai) service for anyone to try with zero setup. It provides all the capabilities of the self-deployed version, and includes 200 free GPT-4 calls in the sandbox plan.

- **Self-hosting Dify Community Edition</br>**
  Quickly get Dify running in your environment with this [starter guide](#quick-start).
  Use our [documentation](https://docs.dify.ai) for further references and more in-depth instructions.

- **Dify for enterprise / organizations</br>**
  We provide additional enterprise-centric features. [Log your questions for us through this chatbot](https://udify.app/chat/22L1zSxg6yW1cWQg) or [send us an email](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry) to discuss enterprise needs. </br>
  > For startups and small businesses using AWS, check out [Dify Premium on AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6) and deploy it to your own AWS VPC with one click. It's an affordable AMI offering with the option to create apps with custom logo and branding.

## Staying ahead

Star Dify on GitHub and be instantly notified of new releases.

![star-us](https://github.com/langgenius/dify/assets/13230914/b823edc1-6388-4e25-ad45-2f6b187adbb4)

## Advanced Setup

If you need to customize the configuration, please refer to the comments in our [.env.example](docker/.env.example) file and update the corresponding values in your `.env` file. Additionally, you might need to make adjustments to the `docker-compose.yaml` file itself, such as changing image versions, port mappings, or volume mounts, based on your specific deployment environment and requirements. After making any changes, please re-run `docker-compose up -d`. You can find the full list of available environment variables [here](https://docs.dify.ai/getting-started/install-self-hosted/environments).

If you'd like to configure a highly-available setup, there are community-contributed [Helm Charts](https://helm.sh/) and YAML files which allow Dify to be deployed on Kubernetes.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)

#### Using Terraform for Deployment

Deploy Dify to Cloud Platform with a single click using [terraform](https://www.terraform.io/)

##### Azure Global

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

##### Google Cloud

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

#### Using AWS CDK for Deployment

Deploy Dify to AWS with [CDK](https://aws.amazon.com/cdk/)

##### AWS

- [AWS CDK by @KevinZhao](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)

#### Using Alibaba Cloud Computing Nest

Quickly deploy Dify to Alibaba cloud with [Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88) 

#### Using Alibaba Cloud Data Management

One-Click deploy Dify to Alibaba Cloud with [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/) 


## Contributing

For those who'd like to contribute code, see our [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md).
At the same time, please consider supporting Dify by sharing it on social media and at events and conferences.

> We are looking for contributors to help translate Dify into languages other than Mandarin or English. If you are interested in helping, please see the [i18n README](https://github.com/langgenius/dify/blob/main/web/i18n/README.md) for more information, and leave us a comment in the `global-users` channel of our [Discord Community Server](https://discord.gg/8Tpq4AcN9c).

## Community & contact

- [GitHub Discussion](https://github.com/langgenius/dify/discussions). Best for: sharing feedback and asking questions.
- [GitHub Issues](https://github.com/langgenius/dify/issues). Best for: bugs you encounter using Dify.AI, and feature proposals. See our [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md).
- [Discord](https://discord.gg/FngNHpbcY7). Best for: sharing your applications and hanging out with the community.
- [X(Twitter)](https://twitter.com/dify_ai). Best for: sharing your applications and hanging out with the community.

**Contributors**

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## Security disclosure

To protect your privacy, please avoid posting security issues on GitHub. Instead, send your questions to security@dify.ai and we will provide you with a more detailed answer.

## License

This repository is available under the [Dify Open Source License](LICENSE), which is essentially Apache 2.0 with a few additional restrictions.

# Dify 多智能体记忆问题复现方案

## 问题概述

根据 [GitHub Issue #21640](https://github.com/langgenius/dify/issues/21640)，在多智能体聊天流程系统中存在记忆隔离问题：

- 每个智能体都有记忆功能（10条消息）
- 当对话流程切换到不同智能体时，新智能体会看到来自其他智能体的聊天历史
- 这导致智能体产生"幻觉"（hallucination），回答不准确

## 复现方法

### 方法1：手动复现（推荐）

1. **登录Dify控制台**
   - 访问您的Dify实例
   - 登录管理员账户

2. **创建工作流应用**
   - 创建新的工作流应用
   - 选择"工作流"模式

3. **添加节点**
   ```
   Start节点 → 问题分类器 → Agent A (技术) / Agent B (商业) → End节点
   ```

4. **配置智能体**
   - **Agent A**：
     - 系统提示词："你是Agent A，专门处理技术问题"
     - 启用记忆：窗口大小10
   - **Agent B**：
     - 系统提示词："你是Agent B，专门处理商业问题"  
     - 启用记忆：窗口大小10

5. **配置路由逻辑**
   - 使用问题分类器根据内容类型路由
   - 技术问题 → Agent A
   - 商业问题 → Agent B

6. **测试场景**
   ```
   用户: "如何配置Docker容器？" → Agent A回答
   用户: "什么是Kubernetes？" → Agent A回答  
   用户: "如何制定营销策略？" → Agent B回答（可能引用技术内容）
   用户: "如何提高客户满意度？" → Agent B回答（可能引用技术内容）
   ```

7. **观察问题**
   - 检查Agent B的回答是否包含Docker、Kubernetes等技术相关内容
   - 如果包含，说明存在记忆隔离问题

### 方法2：使用复现脚本

1. **配置脚本**
   ```bash
   # 编辑 reproduction_script.py
   DIFY_BASE_URL = "http://your-dify-instance.com"
   DIFY_API_KEY = "your_api_key_here"
   ```

2. **运行脚本**
   ```bash
   python reproduction_script.py
   ```

3. **分析结果**
   - 脚本会自动检测Agent B回答中的技术关键词
   - 如果发现技术相关内容，说明存在记忆隔离问题

## 问题分析

### 当前实现机制

1. **记忆存储**：所有节点共享同一个对话ID
2. **记忆获取**：基于整个对话获取历史消息
3. **记忆配置**：每个节点可独立配置，但都基于同一对话

### 核心问题

```python
# 当前记忆获取逻辑 (api/core/workflow/nodes/llm/llm_utils.py)
def fetch_memory(variable_pool, app_id, node_data_memory, model_instance):
    # 获取对话ID
    conversation_id = variable_pool.get(["sys", "CONVERSATION_ID"])
    
    # 基于整个对话获取记忆 - 问题所在
    conversation = session.scalar(stmt)
    memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)
```

## 解决方案

### 方案1：节点特定记忆（推荐）

1. **修改MemoryConfig**
   ```python
   class MemoryConfig(BaseModel):
       window: WindowConfig
       role_prefix: Optional[RolePrefix] = None
       query_prompt_template: Optional[str] = None
       # 新增：节点特定记忆开关
       node_specific_memory: bool = False
   ```

2. **修改记忆获取逻辑**
   ```python
   def fetch_memory(variable_pool, app_id, node_data_memory, model_instance, node_id):
       # 如果启用节点特定记忆，只获取该节点的历史
       if node_data_memory and node_data_memory.node_specific_memory:
           # 过滤该节点的消息历史
           pass
   ```

3. **前端UI修改**
   - 在记忆配置中添加"节点特定记忆"开关
   - 提供用户友好的说明文字

### 方案2：记忆过滤

1. **数据库层面过滤**
   - 在Message表中添加node_id字段
   - 根据节点ID过滤历史消息

2. **应用层面过滤**
   - 在记忆获取时添加节点过滤条件
   - 只包含特定节点参与的消息

### 方案3：记忆上下文切换

1. **动态记忆管理**
   - 在节点切换时调整记忆上下文
   - 根据节点类型选择性地包含历史

## 实施步骤

### 后端修改

1. **修改数据模型**
   ```sql
   -- 可选：在Message表中添加node_id字段
   ALTER TABLE messages ADD COLUMN node_id VARCHAR(255);
   CREATE INDEX idx_messages_node_id ON messages(node_id);
   ```

2. **修改核心代码**
   - `api/core/prompt/entities/advanced_prompt_entities.py`
   - `api/core/memory/token_buffer_memory.py`
   - `api/core/workflow/nodes/llm/llm_utils.py`

3. **添加测试用例**
   - 单元测试验证记忆隔离功能
   - 集成测试验证多智能体场景

### 前端修改

1. **UI组件更新**
   - `web/app/components/workflow/nodes/_base/components/memory-config.tsx`
   - 添加节点特定记忆开关

2. **国际化支持**
   - 在 `web/i18n/zh-Hans/workflow.ts` 中添加相关文本

3. **类型定义更新**
   - 更新TypeScript类型定义

## 测试验证

### 功能测试

1. **记忆隔离测试**
   - 验证节点特定记忆开关是否正常工作
   - 验证不同节点的记忆是否隔离

2. **多智能体测试**
   - 测试技术Agent和商业Agent的记忆隔离
   - 验证回答的准确性和相关性

### 性能测试

1. **记忆过滤性能**
   - 验证记忆过滤对性能的影响
   - 确保在大规模对话中的稳定性

2. **数据库查询优化**
   - 验证节点过滤查询的性能
   - 确保索引的有效性

### 用户体验测试

1. **功能易用性**
   - 验证用户是否能够理解和使用新功能
   - 确保配置界面的友好性

2. **向后兼容性**
   - 验证现有工作流是否正常工作
   - 确保默认行为保持不变

## 预期效果

### 问题解决

1. **消除幻觉**：Agent B不再看到Agent A的技术对话历史
2. **提高准确性**：每个智能体只基于自己的专业领域回答
3. **改善用户体验**：多智能体对话更加准确和连贯

### 功能增强

1. **灵活配置**：用户可以选择是否启用节点特定记忆
2. **向后兼容**：现有工作流无需修改即可正常工作
3. **性能优化**：通过记忆过滤减少不必要的上下文

## 相关文件

- `reproduction_steps.md` - 详细的复现步骤
- `implementation_example.py` - 实现示例代码
- `reproduction_script.py` - 自动化复现脚本

## 贡献指南

如果您想为这个功能做出贡献：

1. Fork Dify仓库
2. 创建功能分支
3. 实现节点特定记忆功能
4. 添加测试用例
5. 提交Pull Request

## 联系方式

- GitHub Issue: [#21640](https://github.com/langgenius/dify/issues/21640)
- 项目主页: [https://github.com/langgenius/dify](https://github.com/langgenius/dify)
