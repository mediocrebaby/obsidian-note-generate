import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import NoteGeneratePlugin from "./main";
import { OpenAIClient } from "./provider/openai";
import { AnthropicClient } from "./provider/anthropic";

export type AIProvider = "OpenAI" | "Anthropic";

export interface NoteGeneratePluginSettings {
	provider: AIProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	streaming: boolean;
	maxTokens: number;
}

export const DEFAULT_SETTINGS: NoteGeneratePluginSettings = {
	provider: "OpenAI",
	baseUrl: "https://api.openai.com",
	apiKey: "",
	model: "gpt-5.2",
	streaming: true,
	maxTokens: 4096
}

// 供应商配置
const PROVIDER_CONFIG = {
	OpenAI: {
		defaultUrl: "https://api.openai.com",
		defaultModel: "gpt-5.2"
	},
	Anthropic: {
		defaultUrl: "https://api.anthropic.com",
		defaultModel: "claude-sonnet-5@20260203"
	}
};

export class NoteGenerateSettingTab extends PluginSettingTab {
	plugin: NoteGeneratePlugin;
	private modelCache: Map<AIProvider, string[]> = new Map();

	constructor(app: App, plugin: NoteGeneratePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "AI Note Generate Settings" });

		// 提供商选择
		new Setting(containerEl)
			.setName("AI Provider")
			.setDesc("Choose your AI provider")
			.addDropdown(dropdown => dropdown
				.addOption("OpenAI", "OpenAI")
				.addOption("Anthropic", "Anthropic")
				.setValue(this.plugin.settings.provider)
				.onChange(async (value: AIProvider) => {
					this.plugin.settings.provider = value;
					// 切换提供商时更新默认 URL 和模型
					this.plugin.settings.baseUrl = PROVIDER_CONFIG[value].defaultUrl;
					this.plugin.settings.model = PROVIDER_CONFIG[value].defaultModel;
					await this.plugin.saveSettings();
					this.display(); // 重新渲染设置页面
				}));

		// Base URL
		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("API base URL (will be auto-corrected)")
			.addText(text => text
				.setPlaceholder(PROVIDER_CONFIG[this.plugin.settings.provider].defaultUrl)
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					// URL 校正
					let correctedUrl = value.trim();
					if (correctedUrl && !correctedUrl.startsWith("http")) {
						correctedUrl = "https://" + correctedUrl;
					}
					// 移除末尾的斜杠
					if (correctedUrl.endsWith("/")) {
						correctedUrl = correctedUrl.slice(0, -1);
					}
					this.plugin.settings.baseUrl = correctedUrl;
					await this.plugin.saveSettings();
					// 更新输入框显示校正后的值
					text.setValue(correctedUrl);
				}));

		// API Key
		new Setting(containerEl)
			.setName("API Key")
			.setDesc("Your API key")
			.addText(text => {
				text.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				// 设置为密码输入
				text.inputEl.type = "password";
			});

		// 模型选择
		new Setting(containerEl)
			.setName("Model")
			.setDesc("AI model to use")
			.addDropdown(dropdown => {
				// 添加默认模型
				dropdown.addOption(
					PROVIDER_CONFIG[this.plugin.settings.provider].defaultModel,
					PROVIDER_CONFIG[this.plugin.settings.provider].defaultModel + " (Default)"
				);

				// 设置当前值
				dropdown.setValue(this.plugin.settings.model);

				// 当下拉框获得焦点时加载模型列表
				dropdown.selectEl.addEventListener("focus", async () => {
					await this.loadModels(dropdown);
				});

				dropdown.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});
			});

		// 流式输出
		new Setting(containerEl)
			.setName("Streaming")
			.setDesc("Enable streaming output")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.streaming)
				.onChange(async (value) => {
					this.plugin.settings.streaming = value;
					await this.plugin.saveSettings();
				}));

		// Max Tokens
		new Setting(containerEl)
			.setName("Max Tokens")
			.setDesc("Maximum tokens to generate")
			.addText(text => text
				.setPlaceholder("4096")
				.setValue(String(this.plugin.settings.maxTokens))
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue > 0) {
						this.plugin.settings.maxTokens = numValue;
						await this.plugin.saveSettings();
					}
				}));
	}

	/**
	 * 加载模型列表
	 */
	private async loadModels(dropdown: any): Promise<void> {
		const provider = this.plugin.settings.provider;

		// 检查缓存
		if (this.modelCache.has(provider)) {
			this.populateModels(dropdown, this.modelCache.get(provider)!);
			return;
		}

		// 如果没有 API Key，不请求
		if (!this.plugin.settings.apiKey) {
			new Notice("Please set API Key first");
			return;
		}

		try {
			const models = await this.fetchModels();
			this.modelCache.set(provider, models);
			this.populateModels(dropdown, models);
		} catch (error) {
			new Notice("Failed to load models: " + (error as Error).message);
			console.error("Failed to load models:", error);
		}
	}

	/**
	 * 从 API 获取模型列表
	 */
	private async fetchModels(): Promise<string[]> {
		const provider = this.plugin.settings.provider;
		const baseUrl = this.plugin.settings.baseUrl;
		const apiKey = this.plugin.settings.apiKey;

		try {
			if (provider === "OpenAI") {
				const client = new OpenAIClient({
					apiKey,
					baseURL: baseUrl
				});
				const response = await client.listModels();
				return response.data.map(model => model.id);
			} else if (provider === "Anthropic") {
				const client = new AnthropicClient({
					apiKey,
					baseURL: baseUrl
				});
				const response = await client.getModels();
				return response.data.map(model => model.id);
			}
		} catch (error) {
			throw error;
		}

		return [];
	}

	/**
	 * 填充下拉框选项
	 */
	private populateModels(dropdown: any, models: string[]): void {
		const currentValue = dropdown.getValue();

		// 清空现有选项
		dropdown.selectEl.empty();

		// 添加默认模型
		const defaultModel = PROVIDER_CONFIG[this.plugin.settings.provider].defaultModel;
		dropdown.addOption(defaultModel, defaultModel + " (Default)");

		// 添加从 API 获取的模型
		models.forEach(model => {
			if (model !== defaultModel) {
				dropdown.addOption(model, model);
			}
		});

		// 恢复之前选择的值
		if (currentValue && models.includes(currentValue)) {
			dropdown.setValue(currentValue);
		}
	}
}
