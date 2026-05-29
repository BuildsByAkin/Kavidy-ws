import type { StreamerRow } from '../database/schema/streamers';

export interface PublicStreamer {
  id: number;
  handle: string;
  displayName: string;
  platform: StreamerRow['platform'];
  avatarUrl: string | null;
}

export function toPublicStreamer(row: StreamerRow): PublicStreamer {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    platform: row.platform,
    avatarUrl: row.avatarUrl,
  };
}
