import { Editor, MarkdownView, Notice, Plugin, EditorPosition } from 'obsidian';
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
		const loadedData = await this.loadData() as Partial<NoteGeneratePluginSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		// 数据迁移：确保 providerSettings 存在且完整
		if (!this.settings.providerSettings) {
			this.settings.providerSettings = {
				OpenAI: {
					baseUrl: this.settings.baseUrl,
					apiKey: this.settings.apiKey,
					model: this.settings.model
				},
				Anthropic: {
					baseUrl: DEFAULT_SETTINGS.providerSettings.Anthropic.baseUrl,
					apiKey: "",
					model: DEFAULT_SETTINGS.providerSettings.Anthropic.model
				}
			};
		} else {
			// 确保每个提供商都有配置
			if (!this.settings.providerSettings.OpenAI) {
				this.settings.providerSettings.OpenAI = DEFAULT_SETTINGS.providerSettings.OpenAI;
			}
			if (!this.settings.providerSettings.Anthropic) {
				this.settings.providerSettings.Anthropic = DEFAULT_SETTINGS.providerSettings.Anthropic;
			}
		}

		// 保存迁移后的设置
		await this.saveSettings();
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
				constructor(public view: EditorView) { }

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
							const cmView = update.view;
							setTimeout(() => {
								const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
								if (view && view.editor) {
									const cursor = view.editor.getCursor();
									const line = view.editor.getLine(cursor.line);
									const charBefore = line[cursor.ch - 1];

									// 再次确认光标前确实是 @ 字符
									if (charBefore === '@') {
										const cmCursor = cmView.state.selection.main.head;
										const coords = cmView.coordsAtPos(cmCursor);
										if (coords) {
											const floatInput = new PromptFloatingInput(
												coords,
												view.editor,
												cursor,
												plugin
											);
											floatInput.open();
										}
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
		// 创建加载指示器
		let loadingRemoved = false;
		let loadingEl: HTMLElement | null = null;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView) {
			// @ts-ignore - 访问内部 CM6 EditorView
			const cmView = mdView.editor.cm as EditorView;
			if (cmView) {
				const cmCursor = cmView.state.selection.main.head;
				const coords = cmView.coordsAtPos(cmCursor);
				if (coords) {
					loadingEl = document.createElement('div');
					loadingEl.addClass('ng-loading-indicator');
					for (let i = 0; i < 3; i++) {
						loadingEl.createDiv('ng-loading-dot');
					}
					const gap = 4;
					loadingEl.style.top = `${coords.bottom + window.scrollY + gap}px`;
					loadingEl.style.left = `${coords.left + window.scrollX}px`;
					document.body.appendChild(loadingEl);
				}
			}
		}

		const removeLoading = () => {
			if (loadingRemoved || !loadingEl) return;
			loadingRemoved = true;
			loadingEl.addClass('ng-fade-out');
			setTimeout(() => loadingEl?.remove(), 150);
		};

		try {
			const provider = this.settings.provider;
			const apiKey = this.settings.apiKey;
			const baseUrl = this.settings.baseUrl;
			const model = this.settings.model;
			const maxTokens = this.settings.maxTokens;
			const streaming = this.settings.streaming;

			if (!apiKey) {
				removeLoading();
				new Notice("Please configure API Key in settings");
				return;
			}

			// 记录开始位置
			let currentPos = { ...startPos };

			// 提取光标前后的笔记内容，构建 system prompt
			const lastLine = editor.lastLine();
			const lastLineLen = editor.getLine(lastLine).length;
			const beforeCursor = editor.getRange({ line: 0, ch: 0 }, startPos);
			const afterCursor = editor.getRange(startPos, { line: lastLine, ch: lastLineLen });

			const systemPrompt = `你是一个 Obsidian 笔记写作助手。
当前笔记内容如下（[CURSOR] 标记了你需要插入内容的位置）：

\`\`\`
${beforeCursor}[CURSOR]${afterCursor}
\`\`\`

重要规则：
- 直接输出要插入到笔记的文字内容
- 不要添加任何解释、前言、说明或总结
- 不要输出"好的"、"当然"、"以下是..."等客套话
- 输出的内容会被直接插入到笔记的 [CURSOR] 位置`;

			if (provider === "OpenAI") {
				const client = new OpenAIClient({
					apiKey,
					baseURL: baseUrl
				});

				if (streaming) {
					await client.createChatCompletionStream(
						{
							model,
							messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
							max_tokens: maxTokens
						},
						(chunk: string) => {
							removeLoading();
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
						messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
						max_tokens: maxTokens
					});
					removeLoading();
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
							system: [{ type: 'text', text: systemPrompt }],
							messages: [
								{ role: 'user', content: prompt }
							],
							max_tokens: maxTokens
						},
						(chunk: string) => {
							removeLoading();
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
						system: [{ type: 'text', text: systemPrompt }],
						messages: [
							{ role: 'user', content: prompt }
						],
						max_tokens: maxTokens
					});
					removeLoading();
					const content = response.content[0]?.text;
					if (content) {
						editor.replaceRange(content, currentPos);
					}
				}
			}
		} catch (error) {
			removeLoading();
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Error: ${errorMessage}`);
			console.error("AI generation error:", error);
		}
	}
}

/**
 * 跟随光标的浮层提示词输入框
 */
class PromptFloatingInput {
	private container: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private outsideClickHandler: (evt: MouseEvent) => void;

	constructor(
		private anchorRect: { top: number; left: number; bottom: number; right: number },
		private editor: Editor,
		private atPosition: EditorPosition,
		private plugin: NoteGeneratePlugin
	) { }

	open() {
		// 创建浮层容器
		this.container = document.createElement('div');
		this.container.addClass('ng-float-wrap');

		// 头部
		const header = this.container.createDiv('ng-float-header');
		header.createSpan({ cls: 'ng-float-icon', text: '✦' });
		header.createSpan({ cls: 'ng-float-title', text: 'AI Prompt' });

		// 输入框
		this.inputEl = this.container.createEl('textarea', {
			cls: 'ng-float-input',
			attr: { placeholder: 'Enter your prompt...', rows: '2' }
		});

		// 底部工具栏
		const footer = this.container.createDiv('ng-float-footer');
		footer.createSpan({ cls: 'ng-float-hint', text: '↵ 提交  ^↵ 换行  Esc 取消' });
		const submitBtn = footer.createEl('button', { cls: 'ng-float-submit', text: '生成 →' });
		submitBtn.addEventListener('click', () => this.submit());

		// 定位浮层
		this.positionContainer();

		document.body.appendChild(this.container);

		// 聚焦输入框
		this.inputEl.focus();

		// 键盘事件
		this.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter' && !evt.ctrlKey) {
				evt.preventDefault();
				this.submit();
			} else if (evt.key === 'Enter' && evt.ctrlKey) {
				evt.preventDefault();
				const start = this.inputEl.selectionStart;
				const end = this.inputEl.selectionEnd;
				const value = this.inputEl.value;
				this.inputEl.value = value.substring(0, start) + '\n' + value.substring(end);
				this.inputEl.selectionStart = this.inputEl.selectionEnd = start + 1;
			} else if (evt.key === 'Escape') {
				this.close();
			}
		});

		// 点击浮层外部关闭
		this.outsideClickHandler = (evt: MouseEvent) => {
			if (!this.container.contains(evt.target as Node)) {
				this.close();
			}
		};
		// 延迟注册，避免触发当前点击事件
		setTimeout(() => {
			document.addEventListener('mousedown', this.outsideClickHandler);
		}, 0);
	}

	close() {
		if (this.container) {
			this.container.remove();
		}
		document.removeEventListener('mousedown', this.outsideClickHandler);
	}

	private positionContainer() {
		const floatWidth = 480;
		const gap = 4;

		let top = this.anchorRect.bottom + window.scrollY + gap;
		let left = this.anchorRect.left + window.scrollX;

		// 防止超出右侧边界
		if (left + floatWidth > window.innerWidth) {
			left = window.innerWidth - floatWidth - 10;
		}

		// 防止超出底部：估算浮层高度约 130px，超出则显示在光标上方
		const estimatedHeight = 130;
		if (this.anchorRect.bottom + estimatedHeight > window.innerHeight) {
			top = this.anchorRect.top + window.scrollY - estimatedHeight - gap;
		}

		this.container.style.top = `${top}px`;
		this.container.style.left = `${left}px`;
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
