import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import NoteGeneratePlugin from "./main";
import { OpenAIClient } from "./provider/openai";
import { AnthropicClient } from "./provider/anthropic";

export type AIProvider = "OpenAI" | "Anthropic";

// 单个提供商的配置
interface ProviderSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export interface NoteGeneratePluginSettings {
	provider: AIProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	streaming: boolean;
	maxTokens: number;
	// 每个提供商的特定配置存储
	providerSettings: {
		[key in AIProvider]: ProviderSettings;
	};
}

export const DEFAULT_SETTINGS: NoteGeneratePluginSettings = {
	provider: "OpenAI",
	baseUrl: "https://api.openai.com",
	apiKey: "",
	model: "gpt-5.2",
	streaming: true,
	maxTokens: 4096,
	providerSettings: {
		OpenAI: {
			baseUrl: "https://api.openai.com",
			apiKey: "",
			model: "gpt-5.2"
		},
		Anthropic: {
			baseUrl: "https://api.anthropic.com",
			apiKey: "",
			model: "claude-sonnet-5@20260203"
		}
	}
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

	/**
	 * 保存当前提供商的配置
	 */
	private saveCurrentProviderSettings(): void {
		const currentProvider = this.plugin.settings.provider;
		this.plugin.settings.providerSettings[currentProvider] = {
			baseUrl: this.plugin.settings.baseUrl,
			apiKey: this.plugin.settings.apiKey,
			model: this.plugin.settings.model
		};
	}

	/**
	 * 加载指定提供商的配置
	 */
	private loadProviderSettings(provider: AIProvider): void {
		const providerSettings = this.plugin.settings.providerSettings[provider];
		this.plugin.settings.baseUrl = providerSettings.baseUrl;
		this.plugin.settings.apiKey = providerSettings.apiKey;
		this.plugin.settings.model = providerSettings.model;
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
					// 保存当前提供商的配置
					this.saveCurrentProviderSettings();

					// 切换提供商
					this.plugin.settings.provider = value;

					// 加载新提供商的配置
					this.loadProviderSettings(value);

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
					// 同步保存到当前提供商的配置
					this.plugin.settings.providerSettings[this.plugin.settings.provider].baseUrl = correctedUrl;
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
						// 同步保存到当前提供商的配置
						this.plugin.settings.providerSettings[this.plugin.settings.provider].apiKey = value;
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
				const defaultModel = PROVIDER_CONFIG[this.plugin.settings.provider].defaultModel;
				const currentModel = this.plugin.settings.model;

				// 添加默认模型
				dropdown.addOption(defaultModel, defaultModel + " (Default)");

				// 如果当前模型不是默认模型，也添加到选项中
				if (currentModel && currentModel !== defaultModel) {
					dropdown.addOption(currentModel, currentModel);
				}

				// 设置当前值
				dropdown.setValue(currentModel);

				// 进入设置页面时立即加载模型列表
				this.loadModels(dropdown);

				// 当下拉框获得焦点时也加载模型列表（作为备用）
				dropdown.selectEl.addEventListener("focus", async () => {
					await this.loadModels(dropdown);
				});

				dropdown.onChange(async (value) => {
					this.plugin.settings.model = value;
					// 同步保存到当前提供商的配置
					this.plugin.settings.providerSettings[this.plugin.settings.provider].model = value;
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
		// 如果当前值存在，检查是否在模型列表中或是默认模型
		if (currentValue && (models.includes(currentValue) || currentValue === defaultModel)) {
			dropdown.setValue(currentValue);
		} else if (currentValue && !models.includes(currentValue) && currentValue !== defaultModel) {
			// 如果当前值不在列表中且不是默认模型，也添加它以保持用户的选择
			dropdown.addOption(currentValue, currentValue);
			dropdown.setValue(currentValue);
		}
	}
}
