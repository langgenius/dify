# 真实网页人工交接测试

保持社区版原版行为，不开启配置页 Preview。

入口：Dify /agents → Browser MVP Service API → Access Point → Web App → Open。
发布链接由每次部署生成，请从 Access Point 打开；不要复用其他部署的 Agent ID 或链接。

新建会话，无需附件。只运行一个浏览器测试会话。

第一段：
```text
请在独立浏览器中新建标签页打开 https://en.wikipedia.org，使用网页搜索框搜索 Aviation 并进入词条。报告实际标题和 URL，截图、核对并上传，回复中返回图片和下载链接。然后停止，等待我亲自操作。不要操作工单页，不登录、不编辑、不捐款。
```

人工步骤：noVNC 模式先打开 http://localhost:16090/vnc.html?autoconnect=true&resize=scale；本机 Chrome 模式使用独立窗口。直接在该 Wikipedia 标签页点击另一个词条链接，或用顶部搜索框搜索你自己选的词条并进入。若有募捐横幅，可亲自点击 Maybe later 或关闭。不把目标词条名称发给 Agent。

第二段：
```text
我已在刚才那个 Wikipedia 标签页亲自操作完。先不要导航、刷新或点击。读取这个标签页现在的真实标题和 URL，说明与上一轮页面有什么变化，概括当前词条开头的两点内容。截图、核对并上传，返回图片和下载链接。
```

第三段（可选）：
```text
请根据当前词条实际可见的目录，选择一个与主题相关的小节并点击，报告小节标题，截图上传，然后停止等待我操作。
```

验收：Agent 搜索导致真实网页变化；人操作后，Agent 能读出未被提示的新标题和 URL；截图与页面一致；交接时 Agent 本轮已结束。

准备验证已通过 Agent Service API 打开 Aviation - Wikipedia，实际 URL 为 https://en.wikipedia.org/wiki/Aviation，并上传了 HTTP 200 可下载 PNG。人工交接后续由用户在 Web App 中亲自验证。

实现：noVNC 模式使用容器 Chrome；本机模式由脚本启动独立 Chrome + loopback CDP；sandbox 安装 chrome-devtools-mcp 1.13.0 提供的 CLI 与官方 skill；dify-browser 包装器通过现有 Shell 调用 CLI；容器转发服务通过带 bearer token 的本机 bridge 连接 CDP。没有新增 Dify 核心浏览器工具，也没有把该 CLI 注册成 Dify MCP 工具。

SaaS：官方 Cloud Agent 可使用 Shell/CLI 和工具，但云端不能直接访问本机 localhost/私网。可设计云端浏览器服务，或本机 connector 主动连到受保护的服务端；需要会话授权、同会话人工接管和截图交付。本机 MVP 没有验证 Dify SaaS 端到端部署。
官方资料：https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build
