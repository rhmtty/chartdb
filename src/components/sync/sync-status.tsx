import React from 'react';
import { useSync } from '@/hooks/use-sync';
import { Badge } from '@/components/badge/badge';
import { Button } from '@/components/button/button';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/tooltip/tooltip';
import { AlertTriangle, Cloud, CloudOff, RefreshCw, Save } from 'lucide-react';

export const SyncStatus: React.FC = () => {
    const { enabled, state, autoSave, setAutoSave, saveNow } = useSync();

    if (!enabled) {
        return null;
    }

    const { status, lastSyncAt, error, hasPendingChanges } = state;

    if (status === 'idle' && !hasPendingChanges) {
        return null;
    }

    const renderStatusContent = () => {
        if (status === 'idle' && hasPendingChanges) {
            return (
                <Badge
                    variant="secondary"
                    className="flex gap-1.5 whitespace-nowrap"
                >
                    <Save size={16} />
                    Unsaved changes
                </Badge>
            );
        }

        switch (status) {
            case 'syncing':
                return (
                    <Badge
                        variant="secondary"
                        className="flex gap-1.5 whitespace-nowrap"
                    >
                        <RefreshCw size={16} className="animate-spin" />
                        Syncing...
                    </Badge>
                );
            case 'synced':
                return (
                    <Badge
                        variant="secondary"
                        className="flex gap-1.5 whitespace-nowrap"
                    >
                        <Cloud size={16} />
                        Synced
                    </Badge>
                );
            case 'conflict':
                return (
                    <Badge
                        variant="destructive"
                        className="flex gap-1.5 whitespace-nowrap"
                    >
                        <AlertTriangle size={16} />
                        Sync conflict
                    </Badge>
                );
            case 'error':
                return (
                    <Badge
                        variant="destructive"
                        className="flex gap-1.5 whitespace-nowrap"
                    >
                        <CloudOff size={16} />
                        Sync error
                    </Badge>
                );
            default:
                return null;
        }
    };

    return (
        <div className="flex items-center gap-2">
            <Tooltip>
                <TooltipTrigger>{renderStatusContent()}</TooltipTrigger>
                <TooltipContent>
                    {error ??
                        (lastSyncAt
                            ? `Last synced ${lastSyncAt.toLocaleString()}`
                            : 'Not synced yet')}
                </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setAutoSave(!autoSave)}
                    >
                        {autoSave ? (
                            <Cloud size={16} />
                        ) : (
                            <CloudOff size={16} />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {autoSave
                        ? 'Auto-save is on. Click to disable.'
                        : 'Auto-save is off. Click to enable.'}
                </TooltipContent>
            </Tooltip>

            {!autoSave && hasPendingChanges && (
                <Button
                    size="sm"
                    onClick={() => void saveNow()}
                    disabled={status === 'syncing'}
                >
                    <Save size={16} />
                    Save
                </Button>
            )}
        </div>
    );
};
