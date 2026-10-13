import { diagramSchema, type Diagram } from '@/lib/domain/diagram';
import { SYNC_FILE_VERSION, type SyncPayload } from './types';

/**
 * Serializes a diagram for storage in the shared Bitbucket file.
 *
 * Unlike `diagramToJSONOutput` (export), this preserves stable entity IDs and
 * timestamps so cross-team edits on the same tables merge correctly.
 */
export const diagramToSyncJson = (diagram: Diagram): string => {
    const payload: SyncPayload = {
        version: SYNC_FILE_VERSION,
        syncedAt: new Date().toISOString(),
        diagram,
    };

    return JSON.stringify(payload, null, 2);
};

const toDate = (value: unknown, fallback: Date): Date => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? fallback : value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return fallback;
};

export const diagramFromSyncJson = (json: string): Diagram => {
    const parsed = JSON.parse(json) as Partial<SyncPayload>;

    if (!parsed || parsed.version !== SYNC_FILE_VERSION) {
        throw new Error('Unsupported or missing sync file version.');
    }

    if (!parsed.diagram) {
        throw new Error('Sync file does not contain a diagram.');
    }

    const now = new Date();
    const diagram = diagramSchema.parse({
        ...parsed.diagram,
        createdAt: toDate(parsed.diagram.createdAt, now),
        updatedAt: toDate(parsed.diagram.updatedAt, now),
    });

    return diagram;
};

export const isSyncPayload = (value: unknown): value is SyncPayload => {
    return (
        !!value &&
        typeof value === 'object' &&
        (value as Partial<SyncPayload>).version === SYNC_FILE_VERSION &&
        !!(value as Partial<SyncPayload>).diagram
    );
};
