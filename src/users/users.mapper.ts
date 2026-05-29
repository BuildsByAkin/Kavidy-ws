import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type UserRow,
} from '../database/schema/users';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  emailVerified: boolean;
  status: UserRow['status'];
  role: UserRow['role'];
  onboardingStatus: UserRow['onboardingStatus'];
  displayName: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  country: string;
  state: string | null;
  notificationPrefs: NotificationPrefs;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    emailVerified: row.emailVerified,
    status: row.status,
    role: row.role,
    onboardingStatus: row.onboardingStatus,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    dateOfBirth: row.dateOfBirth,
    country: row.country,
    state: row.state,
    notificationPrefs: row.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS,
    createdAt: row.createdAt.toISOString(),
  };
}
