import type { Diagram } from '@/lib/domain/diagram';

export const SYNC_FILE_VERSION = 1;

export interface SyncConfig {
    apiBase: string;
    workspace: string;
    repo: string;
    branch: string;
    filePath: string;
    gitUrl: string;
    gitCorsProxy: string;
    username: string;
    appPassword: string;
    gitAuthUsername: string;
    gitAuthPassword: string;
    pollIntervalMs: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'conflict';

export interface SyncState {
    status: SyncStatus;
    lastSyncAt: Date | null;
    lastPushedCommit: string | null;
    lastPulledCommit: string | null;
    error: string | null;
    remoteDiagram: Diagram | null;
    hasPendingChanges: boolean;
}

export interface SyncPayload {
    version: typeof SYNC_FILE_VERSION;
    syncedAt: string;
    diagram: Diagram;
}

export interface FileWithCommit {
    content: string | null;
    commitHash: string;
}

export interface BitbucketClientOptions {
    apiBase: string;
    workspace: string;
    repo: string;
    branch: string;
    username: string;
    appPassword: string;
    filePath: string;
}

export interface SyncClient {
    getFileCommitHash: () => Promise<string | null>;
    getFile: () => Promise<FileWithCommit>;
    putFile: (args: { content: string; message: string }) => Promise<string>;
}
