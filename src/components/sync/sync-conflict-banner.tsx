import React from 'react';
import { useSync } from '@/hooks/use-sync';
import { Button } from '@/components/button/button';
import { AlertTriangle } from 'lucide-react';

export const SyncConflictBanner: React.FC = () => {
    const { enabled, state, takeRemote, pushLocal } = useSync();

    if (!enabled || state.status !== 'conflict') {
        return null;
    }

    return (
        <div className="fixed left-1/2 top-3 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-lg border border-destructive/40 bg-background px-4 py-3 shadow-lg">
            <AlertTriangle size={18} className="shrink-0 text-destructive" />
            <div className="flex-1 text-xs text-muted-foreground">
                The shared diagram changed while you had unsaved edits.
                <span className="font-medium text-foreground">
                    {' '}
                    Choose which version to keep.
                </span>
            </div>
            <Button
                variant="outline"
                size="sm"
                onClick={() => void takeRemote()}
            >
                Take remote
            </Button>
            <Button size="sm" onClick={() => void pushLocal()}>
                Push local
            </Button>
        </div>
    );
};
