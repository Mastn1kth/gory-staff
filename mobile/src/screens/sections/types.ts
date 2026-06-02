import type { DataSnapshot, SectionKey, User } from '../../types';
import type { OfflineQueueStatus } from '../../data/api';

export type MutationOptions = {
  returnErrorBody?: boolean;
};

export type MutationFn = (method: string, path: string, body?: unknown, options?: MutationOptions) => Promise<unknown | null>;

export type SectionProps = {
  snapshot: DataSnapshot;
  currentUser: User;
  syncing: boolean;
  navigate: (section: SectionKey) => void;
  onMutate: MutationFn;
  onRefresh: () => void;
  onLogout: () => void;
  apiUrl?: string;
  offline?: boolean;
  queueStatus?: OfflineQueueStatus;
  realtimeStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';
};
