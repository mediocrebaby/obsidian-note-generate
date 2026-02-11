# settings.ts

## 功能
- 定义插件配置数据结构与默认值
- 渲染插件设置界面（AI 提供商、API 密钥、模型选择等）
- 实现 Base URL 自动校正（添加协议、移除末尾斜杠）
- 按需从 API 加载模型列表并缓存
- 提供商切换时自动更新默认 URL 和模型
- 进入设置页面时自动加载模型列表（无需手动触发）
- 保持模型选择状态，避免重新进入时显示为空
- 持久化配置变更

## 边界
- 不负责调用 AI API 生成内容
- 不处理编辑器交互与内容插入
- 不负责 API 请求的重试与错误恢复
- 不验证 API 密钥的有效性（仅存储）

## 职责
- 插件配置的唯一管理者，提供设置界面并协调 AI 提供商配置

## 关键接口
- `NoteGeneratePluginSettings` — 配置数据类型定义
- `DEFAULT_SETTINGS` — 默认配置常量
- `NoteGenerateSettingTab.display()` — 渲染设置界面并触发模型加载
- `NoteGenerateSettingTab.loadModels(dropdown)` — 加载并缓存模型列表
- `NoteGenerateSettingTab.populateModels(dropdown, models)` — 填充模型选项并保持当前选择
- `PROVIDER_CONFIG` — 提供商默认配置映射

## 行为模式
- **模型下拉框初始化**：创建时预填充当前选择的模型（即使不是默认模型）
- **自动加载时机**：`display()` 方法中创建下拉框后立即调用 `loadModels()`
- **状态保持机制**：`populateModels()` 在填充选项后恢复之前的 `currentValue`
- **备用触发**：保留 `focus` 事件监听，作为辅助加载机制
