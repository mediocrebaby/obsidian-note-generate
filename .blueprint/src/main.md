# main.ts

## 功能
- 监听编辑器输入的 `@` 字符，触发 AI 生成对话
- 弹出提示词输入模态框，收集用户需求
- 根据配置调用 OpenAI 或 Anthropic API 生成内容
- 支持流式和非流式两种生成模式
- 实时将生成的内容插入到编辑器光标位置
- 管理插件生命周期（加载/卸载配置）

## 边界
- 不负责 API 的具体实现（由 provider 模块处理）
- 不负责设置界面的渲染（由 settings 模块处理）
- 不处理 API 密钥的验证与加密存储
- 不负责模型列表的获取与缓存

## 职责
- Obsidian 插件的核心入口，协调用户交互、配置管理与 AI 内容生成流程

## 关键接口
- `NoteGeneratePlugin.onload()` — 插件初始化入口
- `NoteGeneratePlugin.createEditorExtension()` — 创建 CodeMirror 扩展监听 @ 输入
- `NoteGeneratePlugin.generateContent(prompt, editor, startPos)` — 调用 AI 生成内容并插入编辑器
- `PromptInputModal` — 提示词输入模态框类
