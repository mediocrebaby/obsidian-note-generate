/**
 * Anthropic API Client
 * Implements the /v1/messages endpoint for chat functionality
 */

// API Types
export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface AnthropicRequestParams {
	model: string;
	messages: AnthropicMessage[];
	max_tokens: number;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	stop_sequences?: string[];
	stream?: boolean;
	system?: string;
}

export interface AnthropicContentBlock {
	type: 'text';
	text: string;
}

export interface AnthropicResponse {
	id: string;
	type: 'message';
	role: 'assistant';
	content: AnthropicContentBlock[];
	model: string;
	stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
	stop_sequence: string | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

export interface AnthropicError {
	type: 'error';
	error: {
		type: string;
		message: string;
	};
}

export interface AnthropicClientConfig {
	apiKey: string;
	apiVersion?: string;
	baseURL?: string;
}

export interface AnthropicModelObject {
	id: string;
	created_at: string;
	display_name: string;
	type: 'model';
}

export interface AnthropicModelsListResponse {
	data: AnthropicModelObject[];
	object: 'list';
	first_id: string;
	last_id: string;
	has_more: boolean;
	next_cursor?: string;
}

export interface GetModelsParams {
	after_id?: string;
	before_id?: string;
	limit?: number; // 1-1000, default 20
}

/**
 * Anthropic API Client
 */
export class AnthropicClient {
	private apiKey: string;
	private apiVersion: string;
	private baseURL: string;

	constructor(config: AnthropicClientConfig) {
		this.apiKey = config.apiKey;
		this.apiVersion = config.apiVersion || '2023-06-01';
		this.baseURL = config.baseURL || 'https://api.anthropic.com';
	}

	/**
	 * Get list of available Anthropic models from API
	 */
	async getModels(params?: GetModelsParams): Promise<AnthropicModelsListResponse> {
		const url = new URL(`${this.baseURL}/v1/models`);

		// Add query parameters if provided
		if (params?.after_id) {
			url.searchParams.append('after_id', params.after_id);
		}
		if (params?.before_id) {
			url.searchParams.append('before_id', params.before_id);
		}
		if (params?.limit) {
			url.searchParams.append('limit', params.limit.toString());
		}

		const headers = {
			'Authorization': `Bearer ${this.apiKey}`,
			'x-api-key': this.apiKey,
			'anthropic-version': this.apiVersion,
		};

		try {
			const response = await fetch(url.toString(), {
				method: 'GET',
				headers: headers,
			});

			if (!response.ok) {
				const errorData = await response.json() as AnthropicError;
				throw new Error(
					`Anthropic API Error (${response.status}): ${errorData.error.message}`
				);
			}

			const data = await response.json() as AnthropicModelsListResponse;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Unknown error occurred: ${error}`);
		}
	}

	/**
	 * Create a message using the /v1/messages endpoint
	 */
	async createMessage(params: AnthropicRequestParams): Promise<AnthropicResponse> {
		const url = `${this.baseURL}/v1/messages`;

		const headers = {
			'Content-Type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': this.apiVersion,
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errorData = await response.json() as AnthropicError;
				throw new Error(
					`Anthropic API Error (${response.status}): ${errorData.error.message}`
				);
			}

			const data = await response.json() as AnthropicResponse;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Unknown error occurred: ${error}`);
		}
	}

	/**
	 * Create a message with streaming support
	 */
	async createMessageStream(
		params: AnthropicRequestParams,
		onChunk: (text: string) => void
	): Promise<void> {
		const url = `${this.baseURL}/v1/messages`;

		const headers = {
			'Content-Type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': this.apiVersion,
		};

		const streamParams = { ...params, stream: true };

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(streamParams),
			});

			if (!response.ok) {
				const errorData = await response.json() as AnthropicError;
				throw new Error(
					`Anthropic API Error (${response.status}): ${errorData.error.message}`
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
							if (parsed.type === 'content_block_delta') {
								const text = parsed.delta?.text;
								if (text) {
									onChunk(text);
								}
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
}
