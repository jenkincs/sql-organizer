import {
  ClassificationRecord,
  OrganizerPlan,
  SqlInventoryItem,
  TaxonomyEntry,
  TaxonomyProposal,
  TaxonomyState,
} from '../domain/models';

const ignoredTopLevelFolders = new Set(['.git', '.sql-organizer', 'archive', 'duplicates', 'inbox', 'node_modules']);

export function categorySlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown'
  );
}

export function categoryLabel(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergeEntry(entries: Map<string, TaxonomyEntry>, entry: TaxonomyEntry): void {
  const existing = entries.get(entry.slug);
  if (!existing) return void entries.set(entry.slug, entry);
  const examples = [...existing.examples, ...entry.examples]
    .filter((example, index, all) => all.findIndex((item) => item.relativePath === example.relativePath) === index)
    .slice(0, 12);
  entries.set(entry.slug, {
    ...existing,
    label: existing.label || entry.label,
    examples,
    source: existing.source === 'approved' || entry.source === 'approved' ? 'approved' : existing.source,
  });
}

/** Builds the reusable local category vocabulary without sending SQL text anywhere. */
export function buildTaxonomyState(
  configuredCategories: string[],
  prior: TaxonomyState | undefined,
  inventory: SqlInventoryItem[],
  records: ClassificationRecord[],
  plan: OrganizerPlan | undefined,
  now = new Date().toISOString(),
): TaxonomyState {
  const entries = new Map<string, TaxonomyEntry>();
  for (const category of configuredCategories) {
    const slug = categorySlug(category);
    mergeEntry(entries, { slug, label: categoryLabel(slug), source: 'configured', examples: [], createdAt: now });
  }
  for (const entry of prior?.entries ?? []) mergeEntry(entries, entry);
  for (const item of inventory) {
    const topLevel = categorySlug(item.relativePath.split('/')[0] ?? '');
    if (!topLevel || ignoredTopLevelFolders.has(topLevel)) continue;
    mergeEntry(entries, {
      slug: topLevel,
      label: categoryLabel(topLevel),
      source: 'discovered',
      examples: [],
      createdAt: now,
    });
  }
  const byId = new Map(inventory.map((item) => [item.id, item]));
  const applied = new Set(
    plan?.actions
      .filter((action) => action.status === 'approved' || action.status === 'applied')
      .map((action) => action.id) ?? [],
  );
  for (const record of records) {
    const item = byId.get(record.itemId);
    if (!item || (!applied.has(item.id) && item.relativePath.startsWith('inbox/'))) continue;
    const slug = categorySlug(record.classification.category);
    mergeEntry(entries, {
      slug,
      label: categoryLabel(slug),
      source: 'approved',
      examples: [
        {
          relativePath: item.relativePath,
          purpose: record.classification.purpose,
          tables: record.classification.tables.slice(0, 6),
        },
      ],
      createdAt: now,
    });
  }
  return {
    version: 1,
    entries: [...entries.values()].sort((left, right) => left.slug.localeCompare(right.slug)),
    updatedAt: now,
  };
}

export function taxonomyPromptContext(
  state: TaxonomyState,
  maxExamples: number,
): {
  categories: string[];
  examples: { category: string; relativePath: string; purpose: string; tables: string[] }[];
} {
  const examples = state.entries
    .flatMap((entry) => entry.examples.map((example) => ({ category: entry.slug, ...example })))
    .slice(0, maxExamples);
  return { categories: state.entries.map((entry) => entry.slug), examples };
}

export function proposeCategory(
  category: string,
  reason: string,
  taxonomy: TaxonomyState,
): TaxonomyProposal | undefined {
  const slug = categorySlug(category);
  if (!slug || slug === 'unknown' || taxonomy.entries.some((entry) => entry.slug === slug)) return undefined;
  return { slug, label: categoryLabel(slug), reason: reason.slice(0, 300) };
}
