import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),

    email: text('email').notNull(),
    username: text('username').notNull(),

    passwordHash: text('password_hash'),

    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

    status: userStatusEnum('status').notNull().default('active'),
    role: userRoleEnum('role').notNull().default('user'),

    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),

    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    country: text('country').notNull().default('US'),
    state: text('state'),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    index('users_status_idx').on(t.status),
    index('users_country_state_idx').on(t.country, t.state),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
