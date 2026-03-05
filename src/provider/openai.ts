/**
 * OpenAI API Client
 * Implements the /v1/responses endpoint
 */

// API Types
export interface OpenAIInputMessage {
	role: 'user' | 'assistant' | 'developer';
	content: string;
}

export interface OpenAIRequestParams {
	model: string;
	input: string | OpenAIInputMessage[];
	max_output_tokens?: number;
	temperature?: number;
	top_p?: number;
	stream?: boolean;
}

export interface OpenAIOutputContent {
	type: 'output_text' | 'refusal';
	text?: string;
	refusal?: string;
}

export interface OpenAIOutputMessage {
	type: 'message';
	id: string;
	role: 'assistant';
	content: OpenAIOutputContent[];
	status: 'completed' | 'in_progress' | 'incomplete';
}

export interface OpenAIResponse {
	id: string;
	object: 'response';
	created_at: number;
	model: string;
	output: OpenAIOutputMessage[];
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
	status: 'completed' | 'failed' | 'in_progress' | 'incomplete';
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
	 * Create a response using the /v1/responses endpoint
	 */
	async createResponse(params: OpenAIRequestParams): Promise<OpenAIResponse> {
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
	 * Create a response with streaming support
	 */
	async createResponseStream(
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
							if (parsed.type === 'response.output_text.delta') {
								const delta = parsed.delta;
								if (delta) {
									onChunk(delta);
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
