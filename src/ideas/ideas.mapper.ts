import type { PostRow } from '../database/schema/posts';
import type { StreamerRow } from '../database/schema/streamers';
import type { UserRow } from '../database/schema/users';
import {
  toPublicStreamer,
  type PublicStreamer,
} from '../streamers/streamers.mapper';

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface PublicPost {
  id: string;
  body: string;
  pinned: boolean;
  likeCount: number;
  likedByMe: boolean;
  author: PostAuthor;
  streamer: PublicStreamer | null;
  createdAt: string;
}

export function toPostAuthor(user: UserRow): PostAuthor {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

export function toPublicPost(
  post: PostRow,
  author: UserRow,
  streamer: StreamerRow | null,
  likedByMe: boolean,
): PublicPost {
  return {
    id: post.id,
    body: post.body,
    pinned: post.pinned,
    likeCount: post.likeCount,
    likedByMe,
    author: toPostAuthor(author),
    streamer: streamer ? toPublicStreamer(streamer) : null,
    createdAt: post.createdAt.toISOString(),
  };
}
