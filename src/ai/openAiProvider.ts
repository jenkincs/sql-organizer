import OpenAI from 'openai';
import { AiProvider, ClassificationInput } from './aiProvider';
import { SqlClassification } from '../domain/models';
import { classificationSchema, normalizeClassificationResponse } from './responseValidator';

export type OpenAiProtocol = 'responses' | 'chat-completions';
export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  protocol?: OpenAiProtocol;
}
const systemPrompt =
  'You are SQL Librarian. Return only a JSON object with category, operation, dialect, purpose, suggestedFilename, tables, parameters, risk, riskReasons, confidence and reviewNotes. Never execute SQL or recommend deletion.';

/** Validates a user-controlled endpoint without retaining credentials or query data. */
export function normalizeBaseUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('AI base URL must be a valid http(s) URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('AI base URL must use http(s) and must not contain credentials, query parameters, or fragments.');
  return url.toString().replace(/\/$/, '');
}

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;
  private readonly protocol: OpenAiProtocol;
  constructor(
    private readonly options: OpenAiProviderOptions,
    client?: OpenAI,
  ) {
    this.protocol = options.protocol ?? 'responses';
    this.client =
      client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: normalizeBaseUrl(options.baseUrl),
        timeout: options.timeoutMs,
        maxRetries: 0,
      });
  }
  async classify(input: ClassificationInput): Promise<SqlClassification> {
    if (!this.options.model)
      throw new Error('OpenAI model is not configured. Set sqlOrganizer.model and retry Analyze.');
    const content =
      this.protocol === 'responses'
        ? await this.classifyWithResponses(input)
        : await this.classifyWithChatCompletions(input);
    return classificationSchema.parse(normalizeClassificationResponse(JSON.parse(content), input.operation));
  }
  async testConnection(): Promise<void> {
    if (!this.options.model) throw new Error('Select a model before testing the connection.');
    if (this.protocol === 'responses') {
      const response = await this.client.responses.create({
        model: this.options.model,
        store: false,
        input: 'Reply with OK.',
        max_output_tokens: 16,
      });
      if (!response.output_text && !response.output?.length)
        throw new Error('The endpoint returned no completion result.');
      return;
    }
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 16,
    });
    if (!response.choices.length) throw new Error('The endpoint returned no completion choices.');
  }
  private async classifyWithResponses(input: ClassificationInput): Promise<string> {
    const response = await this.client.responses.create({
      model: this.options.model,
      store: false,
      instructions: systemPrompt,
      // Some OpenAI-compatible Responses endpoints inspect only `input` when
      // enforcing json_object mode, so keep this explicit instruction here too.
      input: `Return JSON only. ${JSON.stringify(input)}`,
      text: { format: { type: 'json_object' } },
    });
    if (!response.output_text) throw new Error('The AI returned an empty Responses API output.');
    return response.output_text;
  }
  private async classifyWithChatCompletions(input: ClassificationInput): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error('The AI returned an empty Chat Completions output.');
    return content;
  }
}
