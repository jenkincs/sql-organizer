import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { ClassificationRecord, SqlInventoryItem } from '../domain/models';
import { redactSql } from '../scanner/sqlRedactor';
import { sha256 } from '../scanner/sqlAnalyzer';
import { Repository } from '../storage/repository';
import { AiProvider } from './aiProvider';
import { retryableAiError, safeAiErrorMessage } from './classificationRecovery';
import { classificationSchema } from './responseValidator';

export class ClassificationService {
  constructor(
    private readonly root: vscode.Uri,
    private readonly config: OrganizerConfig,
    private readonly repository: Repository,
    private readonly provider: AiProvider,
    private readonly model: string,
  ) {}

  async analyze(items: SqlInventoryItem[], token?: vscode.CancellationToken): Promise<void> {
    const records = await this.repository.classifications();
    const cache = new Map(records.map((record) => [record.cacheKey, record]));
    let next = 0;
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
    const classify = async (item: SqlInventoryItem): Promise<void> => {
      const key = sha256(`${item.rawHash}|v1|${JSON.stringify(this.config.taxonomy.categories)}|${this.model}`);
      if (cache.has(key)) {
        item.classificationStatus = 'analyzed';
        delete item.classificationError;
        return;
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
                categories: this.config.taxonomy.categories,
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
        records.push(record);
        cache.set(key, record);
        item.classificationStatus = 'analyzed';
        delete item.classificationError;
      } catch (error) {
        item.classificationStatus = 'analysis-error';
        item.classificationError = {
          message: safeAiErrorMessage(error),
          retryable: retryableAiError(error),
          occurredAt: new Date().toISOString(),
        };
      }
      await persist();
    };
    const worker = async (): Promise<void> => {
      while (!token?.isCancellationRequested) {
        const item = items[next++];
        if (!item) return;
        if (item.warnings.includes('file-too-large')) continue;
        await classify(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.config.ai.concurrency, items.length) }, worker));
    await persist();
  }
}
