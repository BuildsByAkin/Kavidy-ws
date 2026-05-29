import type { UserRow } from '../database/schema/users';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  emailVerified: boolean;
  status: UserRow['status'];
  role: UserRow['role'];
  displayName: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  country: string;
  state: string | null;
  profileComplete: boolean;
  createdAt: string;
}

export function isProfileComplete(row: UserRow): boolean {
  return Boolean(row.dateOfBirth && row.state);
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    emailVerified: row.emailVerified,
    status: row.status,
    role: row.role,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    dateOfBirth: row.dateOfBirth,
    country: row.country,
    state: row.state,
    profileComplete: isProfileComplete(row),
    createdAt: row.createdAt.toISOString(),
  };
}
