import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { ClassificationRecord, SqlInventoryItem } from '../domain/models';
import { redactSql } from '../scanner/sqlRedactor';
import { sha256 } from '../scanner/sqlAnalyzer';
import { Repository } from '../storage/repository';
import { AiProvider } from './aiProvider';
import { retryableAiError, safeAiErrorMessage } from './classificationRecovery';
import { classificationSchema } from './responseValidator';
import { bindClassificationToItem } from './classificationCache';

export interface ClassificationTaxonomyContext {
  categories: string[];
  examples: { category: string; relativePath: string; purpose: string; tables: string[] }[];
}

export interface ClassificationProgress {
  completed: number;
  total: number;
  item: SqlInventoryItem;
  outcome: 'cached' | 'analyzed' | 'failed';
}

export interface ClassificationSummary {
  total: number;
  completed: number;
  analyzed: number;
  cached: number;
  failed: number;
  cancelled: boolean;
}

/**
 * Cached classifications are keyed by SQL content, not location. When a user moves a
 * workspace, bind the cached result to the newly scanned item ID so planning uses it.
 */
export class ClassificationService {
  constructor(
    private readonly root: vscode.Uri,
    private readonly config: OrganizerConfig,
    private readonly repository: Repository,
    private readonly provider: AiProvider,
    private readonly model: string,
    private readonly taxonomy: ClassificationTaxonomyContext,
  ) {}

  async analyze(
    items: SqlInventoryItem[],
    token?: vscode.CancellationToken,
    onProgress?: (progress: ClassificationProgress) => void,
  ): Promise<ClassificationSummary> {
    const records = await this.repository.classifications();
    const cache = new Map(records.map((record) => [record.cacheKey, record]));
    const eligible = items.filter((item) => !item.warnings.includes('file-too-large'));
    let next = 0;
    let completed = 0;
    let analyzed = 0;
    let cached = 0;
    let failed = 0;
    let saveQueue: Promise<void> = Promise.resolve();
    const persist = (): Promise<void> => {
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(async () => {
          await this.repository.saveClassifications(records);
          await this.repository.saveInventory(items);
        });
      return saveQueue;
    };
    const classify = async (item: SqlInventoryItem): Promise<'cached' | 'analyzed' | 'failed'> => {
      const key = sha256(`${item.rawHash}|units-v2|${JSON.stringify(this.taxonomy)}|${this.model}`);
      const cachedRecord = cache.get(key);
      if (cachedRecord) {
        const rebound = bindClassificationToItem(records, cachedRecord, item.id);
        cache.set(key, rebound);
        item.classificationStatus = 'analyzed';
        delete item.classificationError;
        await persist();
        return 'cached';
      }
      try {
        const sql = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(item.uri))).toString('utf8');
        let classification: ClassificationRecord['classification'] | undefined;
        let finalError: unknown;
        for (let attempt = 0; attempt <= this.config.ai.maxRetries; attempt += 1) {
          try {
            classification = classificationSchema.parse(
              await this.provider.classify({
                relativePath: item.relativePath,
                sizeBytes: item.sizeBytes,
                operation: item.operation,
                dialectHint: item.dialectHint,
                tables: item.tables,
                parameters: item.parameters,
                redactedSql: redactSql(sql).slice(0, this.config.ai.maxSqlChars),
                categories: this.taxonomy.categories,
                taxonomyExamples: this.taxonomy.examples,
              }),
            );
            break;
          } catch (error) {
            finalError = error;
            if (!retryableAiError(error) || attempt === this.config.ai.maxRetries || token?.isCancellationRequested)
              break;
            await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000)));
          }
        }
        if (!classification) throw finalError ?? new Error('AI classification failed.');
        const record: ClassificationRecord = {
          itemId: item.id,
          cacheKey: key,
          classification,
          analyzedAt: new Date().toISOString(),
        };
        const existingIndex = records.findIndex((existing) => existing.itemId === item.id);
        if (existingIndex >= 0) records[existingIndex] = record;
        else records.push(record);
        cache.set(key, record);
        item.classificationStatus = 'analyzed';
        delete item.classificationError;
        await persist();
        return 'analyzed';
      } catch (error) {
        item.classificationStatus = 'analysis-error';
        item.classificationError = {
          message: safeAiErrorMessage(error),
          retryable: retryableAiError(error),
          occurredAt: new Date().toISOString(),
        };
      }
      await persist();
      return 'failed';
    };
    const worker = async (): Promise<void> => {
      while (!token?.isCancellationRequested) {
        const item = eligible[next++];
        if (!item) return;
        const outcome = await classify(item);
        completed += 1;
        if (outcome === 'cached') cached += 1;
        if (outcome === 'analyzed') analyzed += 1;
        if (outcome === 'failed') failed += 1;
        onProgress?.({ completed, total: eligible.length, item, outcome });
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.config.ai.concurrency, eligible.length) }, worker));
    await persist();
    return {
      total: eligible.length,
      completed,
      analyzed,
      cached,
      failed,
      cancelled: Boolean(token?.isCancellationRequested),
    };
  }
}
