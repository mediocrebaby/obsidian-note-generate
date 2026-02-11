# anthropic.ts

## 功能
- 封装 Anthropic Messages API (`/v1/messages`) 调用
- 实现非流式消息生成请求
- 实现流式消息生成，逐块解析 SSE 数据
- 获取可用模型列表 (`/v1/models`)，支持分页参数
- 统一处理 API 错误响应与网络异常

## 边界
- 不负责配置管理与持久化
- 不处理编辑器内容插入（仅通过回调返回文本块）
- 不实现 API 密钥验证逻辑
- 不处理非 Messages API 的其他 Anthropic 端点

## 职责
- Anthropic API 的客户端适配器，提供类型安全的请求与响应处理

## 关键接口
- `AnthropicClient.createMessage(params)` — 非流式消息生成
- `AnthropicClient.createMessageStream(params, onChunk)` — 流式消息生成，回调接收文本块
- `AnthropicClient.getModels(params)` — 获取模型列表
- `AnthropicMessage` / `AnthropicRequestParams` — 请求类型定义
- `AnthropicResponse` / `AnthropicError` — 响应类型定义
