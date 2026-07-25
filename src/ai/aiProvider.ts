import { SqlClassification, SqlDialect, SqlOperation } from '../domain/models';
export interface ClassificationInput {
  relativePath: string;
  sizeBytes: number;
  operation: SqlOperation;
  dialectHint: SqlDialect;
  tables: string[];
  parameters: string[];
  redactedSql: string;
  categories: string[];
  taxonomyExamples?: { category: string; relativePath: string; purpose: string; tables: string[] }[];
}
export interface AiProvider {
  classify(input: ClassificationInput): Promise<SqlClassification>;
}
