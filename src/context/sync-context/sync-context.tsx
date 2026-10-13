import { createContext } from 'react';
import type { Diagram } from '@/lib/domain/diagram';
import type { SyncConfig, SyncState } from '@/lib/sync/types';

export interface SyncContext {
    enabled: boolean;
    config: SyncConfig | null;
    state: SyncState;
    autoSave: boolean;
    setAutoSave: (enabled: boolean) => void;
    saveNow: () => Promise<void>;
    startSync: (diagramId: string) => Promise<void>;
    stopSync: () => void;
    pushNow: () => Promise<void>;
    pullNow: () => Promise<void>;
    fetchRemote: (diagramId: string) => Promise<Diagram | undefined>;
    takeRemote: () => Promise<void>;
    pushLocal: () => Promise<void>;
    registerRemoteApplier: (fn: (diagram: Diagram) => Promise<void>) => void;
}

export const initialSyncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastPushedCommit: null,
    lastPulledCommit: null,
    error: null,
    remoteDiagram: null,
    hasPendingChanges: false,
};

const noop = async () => undefined;

export const syncContext = createContext<SyncContext>({
    enabled: false,
    config: null,
    state: initialSyncState,
    autoSave: false,
    setAutoSave: () => undefined,
    saveNow: noop,
    startSync: noop,
    stopSync: () => undefined,
    pushNow: noop,
    pullNow: noop,
    fetchRemote: async () => undefined,
    takeRemote: noop,
    pushLocal: noop,
    registerRemoteApplier: () => undefined,
});
