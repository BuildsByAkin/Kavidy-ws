import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { IdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';

describe('IdeasController', () => {
  let app: INestApplication;
  let svc: {
    listFeed: jest.Mock;
    createPost: jest.Mock;
    like: jest.Mock;
    unlike: jest.Mock;
  };

  const currentUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'a@b.com',
    role: 'user',
    sessionId: '11111111-1111-4111-8111-111111111111',
  };

  const postId = '33333333-3333-4333-8333-333333333333';

  function samplePost(overrides: Record<string, unknown> = {}) {
    return {
      id: postId,
      body: 'sample idea body',
      pinned: false,
      likeCount: 0,
      likedByMe: false,
      author: {
        id: currentUser.id,
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      },
      streamer: null,
      createdAt: new Date('2025-01-01T10:00:00.000Z').toISOString(),
      ...overrides,
    };
  }

  async function makeApp(opts: { authed?: boolean } = { authed: true }) {
    const mod = await Test.createTestingModule({
      controllers: [IdeasController],
      providers: [
        { provide: IdeasService, useValue: svc },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!opts.authed) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    const a = mod.createNestApplication();
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await a.init();
    return a;
  }

  beforeEach(() => {
    svc = {
      listFeed: jest.fn().mockResolvedValue({
        items: [
          samplePost({
            pinned: true,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          }),
          samplePost({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
        ],
        nextCursor: null,
      }),
      createPost: jest.fn().mockResolvedValue(samplePost()),
      like: jest.fn().mockResolvedValue({ liked: true, likeCount: 1 }),
      unlike: jest.fn().mockResolvedValue({ liked: false, likeCount: 0 }),
    };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /v1/ideas returns paginated feed with pinned first', async () => {
    app = await makeApp();
    const res = await request(app.getHttpServer()).get('/v1/ideas').expect(200);
    expect(svc.listFeed).toHaveBeenCalledWith({
      viewerId: currentUser.id,
      limit: 20,
      cursor: undefined,
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].pinned).toBe(true);
    expect(res.body.items[1].pinned).toBe(false);
    expect(res.body.items[0]).toHaveProperty('likedByMe');
    expect(res.body.items[0]).toHaveProperty('likeCount');
  });

  it('GET /v1/ideas rejects limit > 50', async () => {
    app = await makeApp();
    await request(app.getHttpServer())
      .get('/v1/ideas')
      .query({ limit: '200' })
      .expect(422);
  });

  it('GET /v1/ideas requires auth', async () => {
    app = await makeApp({ authed: false });
    await request(app.getHttpServer()).get('/v1/ideas').expect(403);
  });

  it('POST /v1/ideas creates a post with valid body', async () => {
    app = await makeApp();
    const res = await request(app.getHttpServer())
      .post('/v1/ideas')
      .send({ body: 'hello kavidy world' })
      .expect(201);
    expect(svc.createPost).toHaveBeenCalledWith({
      userId: currentUser.id,
      body: 'hello kavidy world',
      streamerId: undefined,
    });
    expect(res.body.id).toBe(postId);
  });

  it('POST /v1/ideas accepts an optional streamerId tag', async () => {
    app = await makeApp();
    await request(app.getHttpServer())
      .post('/v1/ideas')
      .send({ body: 'tagging a streamer', streamerId: 42 })
      .expect(201);
    expect(svc.createPost).toHaveBeenCalledWith({
      userId: currentUser.id,
      body: 'tagging a streamer',
      streamerId: 42,
    });
  });

  it('POST /v1/ideas rejects body shorter than 6 chars', async () => {
    app = await makeApp();
    await request(app.getHttpServer())
      .post('/v1/ideas')
      .send({ body: 'hey' })
      .expect(422);
    expect(svc.createPost).not.toHaveBeenCalled();
  });

  it('POST /v1/ideas rejects body longer than 280 chars', async () => {
    app = await makeApp();
    await request(app.getHttpServer())
      .post('/v1/ideas')
      .send({ body: 'a'.repeat(281) })
      .expect(422);
    expect(svc.createPost).not.toHaveBeenCalled();
  });

  it('POST /v1/ideas requires auth', async () => {
    app = await makeApp({ authed: false });
    await request(app.getHttpServer())
      .post('/v1/ideas')
      .send({ body: 'hello world from anon' })
      .expect(403);
    expect(svc.createPost).not.toHaveBeenCalled();
  });

  it('POST /v1/ideas/:id/like likes the post', async () => {
    app = await makeApp();
    const res = await request(app.getHttpServer())
      .post(`/v1/ideas/${postId}/like`)
      .expect(200);
    expect(svc.like).toHaveBeenCalledWith(postId, currentUser.id);
    expect(res.body).toEqual({ liked: true, likeCount: 1 });
  });

  it('POST /v1/ideas/:id/like rejects malformed UUID', async () => {
    app = await makeApp();
    await request(app.getHttpServer())
      .post('/v1/ideas/not-a-uuid/like')
      .expect(400);
    expect(svc.like).not.toHaveBeenCalled();
  });

  it('DELETE /v1/ideas/:id/like unlikes the post', async () => {
    app = await makeApp();
    const res = await request(app.getHttpServer())
      .delete(`/v1/ideas/${postId}/like`)
      .expect(200);
    expect(svc.unlike).toHaveBeenCalledWith(postId, currentUser.id);
    expect(res.body).toEqual({ liked: false, likeCount: 0 });
  });

  it('like/unlike require auth', async () => {
    app = await makeApp({ authed: false });
    await request(app.getHttpServer())
      .post(`/v1/ideas/${postId}/like`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/v1/ideas/${postId}/like`)
      .expect(403);
  });
});
