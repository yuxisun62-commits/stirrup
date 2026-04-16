import type { AIProvider, AICreateMessageParams, AIResponse } from "./AIProvider.js";

/**
 * Routes AI requests to the correct provider based on the model name.
 * Falls back to the default provider when no model is specified or the
 * prefix doesn't match a registered provider.
 *
 * Model prefix mapping:
 *   - "gemini-*"  → GeminiProvider
 *   - "claude-*"  → AnthropicProvider (also the default)
 *   - Any other   → default provider
 */
export class ProviderRouter implements AIProvider {
  private providers = new Map<string, AIProvider>();
  private defaultProvider: AIProvider;

  constructor(defaultProvider: AIProvider) {
    this.defaultProvider = defaultProvider;
  }

  /** Register a provider for a model prefix (e.g., "gemini", "claude") */
  register(prefix: string, provider: AIProvider): void {
    this.providers.set(prefix.toLowerCase(), provider);
  }

  /** Pick the right provider based on model name prefix */
  private resolve(model?: string): AIProvider {
    if (!model) return this.defaultProvider;
    const lower = model.toLowerCase();
    for (const [prefix, provider] of this.providers) {
      if (lower.startsWith(prefix)) return provider;
    }
    return this.defaultProvider;
  }

  async createMessage(params: AICreateMessageParams): Promise<AIResponse> {
    const provider = this.resolve(params.model);
    return provider.createMessage(params);
  }

  /** Check if any provider is registered */
  hasProviders(): boolean {
    return this.providers.size > 0 || this.defaultProvider !== undefined;
  }
}
