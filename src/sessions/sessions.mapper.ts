import type { RefreshTokenRow } from '../database/schema/refresh-tokens';

export interface SessionView {
  id: string;
  userId: string;
  familyId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
  active: boolean;
}

export function toSessionView(
  row: RefreshTokenRow,
  currentSessionId?: string,
  now: Date = new Date(),
): SessionView {
  const active = !row.revokedAt && row.expiresAt.getTime() > now.getTime();
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    replacedById: row.replacedById,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    current: currentSessionId === row.id,
    active,
  };
}
