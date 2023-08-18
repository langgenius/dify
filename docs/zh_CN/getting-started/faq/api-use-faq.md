# API 使用

## 什么是Bearer Token？

Bearer 身份验证（也称为令牌认证）是一种涉及名为 bearer 令牌的安全令牌的HTTP认证方案。"Bearer身份验证"的名称可以理解为"给予此令牌的持有者访问权限"。bearer令牌是一串加密的字符串，通常由服务器在响应登录请求时生成。当客户端向受保护资源发出请求时，必须在 Authorization 头中发送此令牌： `Authorization: Bearer <token>`  Bearer 身份验证方案最初是作为 OAuth 2.0 的一部分在RFC 6750 中创建的，但有时也单独使用。与基本认证类似，Bearer认证只应通过 HTTPS（SSL）使用。
