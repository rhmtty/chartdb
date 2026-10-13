import { useContext } from 'react';
import { syncContext } from '@/context/sync-context/sync-context';

export const useSync = () => useContext(syncContext);
