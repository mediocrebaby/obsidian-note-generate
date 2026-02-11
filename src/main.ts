import { App, Editor, MarkdownView, Modal, Notice, Plugin, EditorPosition } from 'obsidian';
import { DEFAULT_SETTINGS, NoteGeneratePluginSettings, NoteGenerateSettingTab } from "./settings";
import { OpenAIClient } from "./provider/openai";
import { AnthropicClient } from "./provider/anthropic";
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';

export default class NoteGeneratePlugin extends Plugin {
	settings: NoteGeneratePluginSettings;

	async onload() {
		await this.loadSettings();

		// 添加设置选项卡
		this.addSettingTab(new NoteGenerateSettingTab(this.app, this));

		// 注册 CodeMirror 扩展
		this.registerEditorExtension(this.createEditorExtension());
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<NoteGeneratePluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 创建 CodeMirror 扩展来检测 @ 输入
	 */
	createEditorExtension(): Extension {
		const plugin = this;

		return ViewPlugin.fromClass(
			class {
				constructor(public view: EditorView) {}

				update(update: ViewUpdate) {
					// 只在文档有变化时处理
					if (!update.docChanged) {
						return;
					}

					// 检查是否是用户输入（不是粘贴等操作）
					const isUserTyping = update.transactions.some(tr => {
						return tr.isUserEvent('input.type');
					});

					if (!isUserTyping) {
						return;
					}

					// 获取变化的内容
					update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
						const insertedText = inserted.toString();

						// 检查是否插入了 @ 字符
						if (insertedText === '@') {
							// 延迟执行，确保 @ 已经插入到编辑器
							setTimeout(() => {
								const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									const cursor = view.editor.getCursor();
									const line = view.editor.getLine(cursor.line);
									const charBefore = line[cursor.ch - 1];

									// 再次确认光标前确实是 @ 字符
									if (charBefore === '@') {
										const modal = new PromptInputModal(
											plugin.app,
											view.editor,
											cursor,
											plugin
										);
										modal.open();
									}
								}
							}, 0);
						}
					});
				}
			}
		);
	}

	/**
	 * 调用 AI 生成内容
	 */
	async generateContent(prompt: string, editor: Editor, startPos: EditorPosition): Promise<void> {
		try {
			const provider = this.settings.provider;
			const apiKey = this.settings.apiKey;
			const baseUrl = this.settings.baseUrl;
			const model = this.settings.model;
			const maxTokens = this.settings.maxTokens;
			const streaming = this.settings.streaming;

			if (!apiKey) {
				new Notice("Please configure API Key in settings");
				return;
			}

			// 记录开始位置
			let currentPos = { ...startPos };

			if (provider === "OpenAI") {
				const client = new OpenAIClient({
					apiKey,
					baseURL: baseUrl
				});

				if (streaming) {
					await client.createChatCompletionStream(
						{
							model,
							messages: [{ role: 'user', content: prompt }],
							max_tokens: maxTokens
						},
						(chunk: string) => {
							// 实时插入内容
							editor.replaceRange(chunk, currentPos);
							// 更新光标位置
							const lines = chunk.split('\n');
							if (lines.length > 1) {
								currentPos.line += lines.length - 1;
								const lastLine = lines[lines.length - 1];
								currentPos.ch = lastLine ? lastLine.length : 0;
							} else {
								currentPos.ch += chunk.length;
							}
						}
					);
				} else {
					const response = await client.createChatCompletion({
						model,
						messages: [{ role: 'user', content: prompt }],
						max_tokens: maxTokens
					});
					const content = response.choices[0]?.message?.content;
					if (content) {
						editor.replaceRange(content, currentPos);
					}
				}
			} else if (provider === "Anthropic") {
				const client = new AnthropicClient({
					apiKey,
					baseURL: baseUrl
				});

				if (streaming) {
					await client.createMessageStream(
						{
							model,
							messages: [{ role: 'user', content: prompt }],
							max_tokens: maxTokens
						},
						(chunk: string) => {
							// 实时插入内容
							editor.replaceRange(chunk, currentPos);
							// 更新光标位置
							const lines = chunk.split('\n');
							if (lines.length > 1) {
								currentPos.line += lines.length - 1;
								const lastLine = lines[lines.length - 1];
								currentPos.ch = lastLine ? lastLine.length : 0;
							} else {
								currentPos.ch += chunk.length;
							}
						}
					);
				} else {
					const response = await client.createMessage({
						model,
						messages: [{ role: 'user', content: prompt }],
						max_tokens: maxTokens
					});
					const content = response.content[0]?.text;
					if (content) {
						editor.replaceRange(content, currentPos);
					}
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Error: ${errorMessage}`);
			console.error("AI generation error:", error);
		}
	}
}

/**
 * 提示词输入框
 */
class PromptInputModal extends Modal {
	private editor: Editor;
	private atPosition: EditorPosition;
	private plugin: NoteGeneratePlugin;
	private inputEl: HTMLTextAreaElement;

	constructor(app: App, editor: Editor, atPosition: EditorPosition, plugin: NoteGeneratePlugin) {
		super(app);
		this.editor = editor;
		this.atPosition = atPosition;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Enter your prompt" });

		// 创建文本输入区域
		this.inputEl = contentEl.createEl("textarea", {
			attr: {
				placeholder: "Enter your prompt here...",
				rows: "5"
			}
		});
		this.inputEl.style.width = "100%";
		this.inputEl.style.marginTop = "10px";
		this.inputEl.style.resize = "vertical";

		// 提示信息
		const hint = contentEl.createEl("div", {
			text: "Press Enter to submit, Ctrl+Enter for new line, Esc to cancel",
			attr: { style: "margin-top: 10px; font-size: 0.9em; color: var(--text-muted);" }
		});

		// 聚焦输入框
		this.inputEl.focus();

		// 监听键盘事件
		this.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter' && !evt.ctrlKey) {
				evt.preventDefault();
				this.submit();
			} else if (evt.key === 'Enter' && evt.ctrlKey) {
				// Ctrl+Enter 插入换行
				evt.preventDefault();
				const start = this.inputEl.selectionStart;
				const end = this.inputEl.selectionEnd;
				const value = this.inputEl.value;
				this.inputEl.value = value.substring(0, start) + '\n' + value.substring(end);
				this.inputEl.selectionStart = this.inputEl.selectionEnd = start + 1;
			} else if (evt.key === 'Escape') {
				// Esc 退出，保留 @ 字符
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async submit() {
		const prompt = this.inputEl.value.trim();
		if (!prompt) {
			new Notice("Prompt cannot be empty");
			return;
		}

		this.close();

		// 删除 @ 字符
		const deleteFrom = {
			line: this.atPosition.line,
			ch: this.atPosition.ch - 1
		};
		const deleteTo = { ...this.atPosition };
		this.editor.replaceRange('', deleteFrom, deleteTo);

		// 调用 AI 生成内容
		await this.plugin.generateContent(prompt, this.editor, deleteFrom);
	}
}
