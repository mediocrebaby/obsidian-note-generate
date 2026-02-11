# openai.ts

## 功能
- 封装 OpenAI Chat Completions API (`/v1/responses` 或自定义端点) 调用
- 实现非流式对话补全请求
- 实现流式对话补全，逐块解析 SSE 数据
- 获取可用模型列表 (`/v1/models`)
- 统一处理 API 错误响应与网络异常
- 支持自定义 API 端点（兼容 OpenAI 兼容服务）

## 边界
- 不负责配置管理与持久化
- 不处理编辑器内容插入（仅通过回调返回文本块）
- 不实现 API 密钥验证逻辑
- 不处理非 Chat Completions 的其他 OpenAI 端点

## 职责
- OpenAI API 的客户端适配器，提供类型安全的请求与响应处理

## 关键接口
- `OpenAIClient.createChatCompletion(params)` — 非流式对话补全
- `OpenAIClient.createChatCompletionStream(params, onChunk)` — 流式对话补全，回调接收文本块
- `OpenAIClient.listModels()` — 获取模型列表
- `OpenAIMessage` / `OpenAIRequestParams` — 请求类型定义
- `OpenAIResponse` / `OpenAIError` — 响应类型定义
