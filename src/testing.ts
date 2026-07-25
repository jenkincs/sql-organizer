/** Internal test-only exports; not referenced by the extension activation path. */
export { defaultConfig } from './config/config';
export { Repository } from './storage/repository';
export { PlanApplier } from './apply/planApplier';
export { rollbackLast } from './apply/rollbackService';
export { sha256 } from './scanner/sqlAnalyzer';
