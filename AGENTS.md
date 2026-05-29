# Repository Guidelines

Kavidy workspace (`kavidy-ws`) is a NestJS 11 + TypeScript service scaffolded from the official starter. The codebase is currently the default starter and has not yet been committed (no git history exists).

## Project Structure & Module Organization

- `src/` — application code. Entry point `src/main.ts` bootstraps the Nest app on port `3000` (or `process.env.PORT`). Root module is `src/app.module.ts`, wiring `AppController` and `AppService`.
- `test/` — end-to-end tests using Supertest. Config in `test/jest-e2e.json` (rootDir `..`, regex `.e2e-spec.ts$`).
- Unit specs live next to source files (`*.spec.ts`) and are picked up by the Jest block in `package.json` with `rootDir: src`.
- Build output goes to `dist/` via `nest build` (uses `tsconfig.build.json`, which extends `tsconfig.json` and excludes tests).
- `nest-cli.json` sets `sourceRoot: src` and `deleteOutDir: true`.

## Build, Test, and Development Commands

- `npm install` — install dependencies.
- `npm run start:dev` — watch-mode dev server.
- `npm run start` / `npm run start:prod` — run once / run compiled `dist/main`.
- `npm run build` — compile with the Nest CLI.
- `npm run lint` — ESLint with `--fix` over `{src,apps,libs,test}/**/*.ts`.
- `npm run format` — Prettier write over `src` and `test`.
- `npm test` — Jest unit tests. Single test: `npx jest src/app.controller.spec.ts` or `npx jest -t "should return"`.
- `npm run test:e2e` — Supertest e2e via `test/jest-e2e.json`.
- `npm run test:cov` — coverage report into `coverage/`.

## Coding Style & Naming Conventions

- Prettier: single quotes, trailing commas `all` (`.prettierrc`). Default 2-space indent.
- ESLint: `@eslint/js` recommended + `typescript-eslint` **type-checked** preset + `eslint-plugin-prettier/recommended`. Project-aware via `parserOptions.projectService`.
- Project overrides: `@typescript-eslint/no-explicit-any` off; `no-floating-promises` and `no-unsafe-argument` are warnings — prefer `await` or explicit `void` on returned promises.
- TS target `ES2023`, `module: nodenext`, decorators enabled, `strictNullChecks: true`, `noImplicitAny: false`.
- File naming follows Nest conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.spec.ts`, `*.e2e-spec.ts`. Classes `PascalCase`, providers/methods `camelCase`.

## Testing Guidelines

- Framework: Jest 30 with `ts-jest`. Unit tests are `*.spec.ts` colocated in `src/`. E2E tests are `*.e2e-spec.ts` in `test/`, bootstrapped through `Test.createTestingModule` against `AppModule`.
- No coverage threshold is configured; `collectCoverageFrom` includes all `.ts`/`.js`. Add tests alongside new providers/controllers and mirror the existing `AppController` pattern.

## Commit & Pull Request Guidelines

- No git history exists yet — establish a convention on the first commit. Recommended: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`) with imperative, lowercase subjects.
- Before pushing: `npm run lint && npm test && npm run build`. PRs should describe the change, link any issue, list manual verification steps, and include screenshots or curl examples for new HTTP endpoints.
