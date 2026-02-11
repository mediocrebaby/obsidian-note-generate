/**
 * OpenAI API Client
 * Implements the /v1/responses (or /v1/chat/completions) endpoint for chat functionality
 */

// API Types
export interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface OpenAIRequestParams {
	model: string;
	messages: OpenAIMessage[];
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	stop?: string | string[];
	stream?: boolean;
}

export interface OpenAIChoice {
	index: number;
	message: {
		role: 'assistant';
		content: string;
	};
	finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface OpenAIResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: OpenAIChoice[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export interface OpenAIError {
	error: {
		message: string;
		type: string;
		param?: string | null;
		code?: string | null;
	};
}

export interface OpenAIModel {
	id: string;
	object: 'model';
	created: number;
	owned_by: string;
}

export interface OpenAIModelsResponse {
	object: 'list';
	data: OpenAIModel[];
}

export interface OpenAIClientConfig {
	apiKey: string;
	baseURL?: string;
	endpoint?: string;
}

/**
 * OpenAI API Client
 */
export class OpenAIClient {
	private apiKey: string;
	private baseURL: string;
	private endpoint: string;

	constructor(config: OpenAIClientConfig) {
		this.apiKey = config.apiKey;
		this.baseURL = config.baseURL || 'https://api.openai.com';
		this.endpoint = config.endpoint || '/v1/responses';
	}

	/**
	 * Create a chat completion using the configured endpoint
	 */
	async createChatCompletion(params: OpenAIRequestParams): Promise<OpenAIResponse> {
		const url = `${this.baseURL}${this.endpoint}`;

		const headers = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.apiKey}`,
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errorData = await response.json() as OpenAIError;
				throw new Error(
					`OpenAI API Error (${response.status}): ${errorData.error.message}`
				);
			}

			const data = await response.json() as OpenAIResponse;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Unknown error occurred: ${error}`);
		}
	}

	/**
	 * Create a chat completion with streaming support
	 */
	async createChatCompletionStream(
		params: OpenAIRequestParams,
		onChunk: (text: string) => void
	): Promise<void> {
		const url = `${this.baseURL}${this.endpoint}`;

		const headers = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.apiKey}`,
		};

		const streamParams = { ...params, stream: true };

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(streamParams),
			});

			if (!response.ok) {
				const errorData = await response.json() as OpenAIError;
				throw new Error(
					`OpenAI API Error (${response.status}): ${errorData.error.message}`
				);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('Response body is not readable');
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') continue;

						try {
							const parsed = JSON.parse(data);
							const content = parsed.choices?.[0]?.delta?.content;
							if (content) {
								onChunk(content);
							}
						} catch (e) {
							// Skip invalid JSON
							continue;
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Unknown error occurred: ${error}`);
		}
	}

	/**
	 * List available models
	 */
	async listModels(): Promise<OpenAIModelsResponse> {
		const url = `${this.baseURL}/v1/models`;

		const headers = {
			'Authorization': `Bearer ${this.apiKey}`,
		};

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: headers,
			});

			if (!response.ok) {
				const errorData = await response.json() as OpenAIError;
				throw new Error(
					`OpenAI API Error (${response.status}): ${errorData.error.message}`
				);
			}

			const data = await response.json() as OpenAIModelsResponse;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Unknown error occurred: ${error}`);
		}
	}
}
