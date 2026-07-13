import { getFieldsForRecord, type FieldDefinition } from './nachaFields';
import { isPrenoteTransaction, transactionCodes, type TransactionKind } from './achRules';

export type AchRecordKind =
  | 'fileHeader'
  | 'batchHeader'
  | 'entryDetail'
  | 'addenda'
  | 'batchControl'
  | 'fileControl'
  | 'padding'
  | 'unknown';

export type AchSourceRange = {
  line: number;
  start: number;
  end: number;
};

export type AchField = FieldDefinition & {
  rawValue: string;
  value: string;
  range: AchSourceRange;
};

export type AchRecord = {
  line: number;
  raw: string;
  recordType: string;
  kind: AchRecordKind;
  range: AchSourceRange;
  secCode: string;
  fields: AchField[];
};

export type AchEntry = {
  detail: AchRecord;
  addenda: AchRecord[];
  records: AchRecord[];
  transactionKind: TransactionKind | 'unknown';
  isPrenote: boolean;
};

export type AchBatch = {
  header: AchRecord;
  secCode: string;
  entryDescription: string;
  isReversal: boolean;
  entries: AchEntry[];
  control?: AchRecord;
  orphanRecords: AchRecord[];
  records: AchRecord[];
};

export type AchDocument = {
  text: string;
  lines: string[];
  records: AchRecord[];
  recordByLine: ReadonlyMap<number, AchRecord>;
  fileHeaders: AchRecord[];
  batches: AchBatch[];
  fileControls: AchRecord[];
  paddingRecords: AchRecord[];
  orphanRecords: AchRecord[];
};

const recordKinds: Record<string, AchRecordKind> = {
  '1': 'fileHeader',
  '5': 'batchHeader',
  '6': 'entryDetail',
  '7': 'addenda',
  '8': 'batchControl',
  '9': 'fileControl',
};

export function isPaddingRecord(raw: string): boolean {
  return raw.length === 94 && /^9{94}$/.test(raw);
}

function createRecord(line: number, raw: string, secCode: string): AchRecord {
  const padding = isPaddingRecord(raw);
  const recordType = raw.charAt(0);
  const kind = padding ? 'padding' : (recordKinds[recordType] ?? 'unknown');
  const contextualSecCode = kind === 'batchHeader' && raw.length >= 53
    ? raw.substring(50, 53).trim()
    : secCode;
  const definitions = padding ? undefined : getFieldsForRecord(recordType, raw, contextualSecCode);

  return {
    line,
    raw,
    recordType,
    kind,
    range: { line, start: 0, end: raw.length },
    secCode: contextualSecCode,
    fields: (definitions ?? []).map(definition => ({
      ...definition,
      rawValue: raw.substring(definition.start, definition.end),
      value: raw.substring(definition.start, definition.end).trim(),
      range: {
        line,
        start: Math.min(definition.start, raw.length),
        end: Math.min(definition.end, raw.length),
      },
    })),
  };
}

/**
 * Parses the physical ACH text into a source-preserving hierarchy.
 *
 * This stage is intentionally lossless and permissive. It records malformed and
 * orphaned records so validation can explain them without the parser guessing at
 * repairs or discarding source text.
 */
export function parseAchDocument(text: string): AchDocument {
  const lines = text.split(/\r?\n/);
  const records: AchRecord[] = [];
  const recordByLine = new Map<number, AchRecord>();
  const fileHeaders: AchRecord[] = [];
  const batches: AchBatch[] = [];
  const fileControls: AchRecord[] = [];
  const paddingRecords: AchRecord[] = [];
  const orphanRecords: AchRecord[] = [];

  let currentBatch: AchBatch | undefined;
  let currentEntry: AchEntry | undefined;

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    if (raw.length === 0) {
      continue;
    }

    const record = createRecord(line, raw, currentBatch?.secCode ?? '');
    records.push(record);
    recordByLine.set(line, record);

    switch (record.kind) {
      case 'fileHeader':
        fileHeaders.push(record);
        currentBatch = undefined;
        currentEntry = undefined;
        break;

      case 'batchHeader': {
        const batch: AchBatch = {
          header: record,
          secCode: record.secCode,
          entryDescription: raw.substring(53, 63).trim(),
          // Nacha requires uppercase REVERSAL in Company Entry Description.
          isReversal: raw.substring(53, 63).trim() === 'REVERSAL',
          entries: [],
          orphanRecords: [],
          records: [record],
        };
        batches.push(batch);
        currentBatch = batch;
        currentEntry = undefined;
        break;
      }

      case 'entryDetail':
        if (currentBatch) {
          const transaction = transactionCodes.get(raw.substring(1, 3));
          const entry: AchEntry = {
            detail: record,
            addenda: [],
            records: [record],
            transactionKind: transaction?.kind ?? 'unknown',
            isPrenote: isPrenoteTransaction(transaction, currentBatch.secCode),
          };
          currentBatch.entries.push(entry);
          currentBatch.records.push(record);
          currentEntry = entry;
        } else {
          orphanRecords.push(record);
          currentEntry = undefined;
        }
        break;

      case 'addenda':
        if (currentBatch && currentEntry) {
          currentEntry.addenda.push(record);
          currentEntry.records.push(record);
          currentBatch.records.push(record);
        } else if (currentBatch) {
          currentBatch.orphanRecords.push(record);
          currentBatch.records.push(record);
        } else {
          orphanRecords.push(record);
        }
        break;

      case 'batchControl':
        if (currentBatch) {
          currentBatch.control = record;
          currentBatch.records.push(record);
        } else {
          orphanRecords.push(record);
        }
        currentBatch = undefined;
        currentEntry = undefined;
        break;

      case 'fileControl':
        fileControls.push(record);
        currentBatch = undefined;
        currentEntry = undefined;
        break;

      case 'padding':
        paddingRecords.push(record);
        break;

      case 'unknown':
        if (currentBatch) {
          currentBatch.orphanRecords.push(record);
          currentBatch.records.push(record);
        } else {
          orphanRecords.push(record);
        }
        currentEntry = undefined;
        break;
    }
  }

  return {
    text,
    lines,
    records,
    recordByLine,
    fileHeaders,
    batches,
    fileControls,
    paddingRecords,
    orphanRecords,
  };
}

export function getAchFieldAtPosition(record: AchRecord, position: number): AchField | undefined {
  return record.fields.find(field => position >= field.range.start && position < field.range.end);
}
