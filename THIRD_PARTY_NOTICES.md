# Third-party notices

Easynews-authored source is MIT licensed. Third-party components retain their own licenses; the root LICENSE does not relicense them.

## Mozilla Readability

`@mozilla/readability` 0.6.0 is included in the Chrome extension bundle. Copyright (c) 2010 Arc90 Inc. Licensed under Apache License 2.0. Preserve its notice and license when distributing the extension.

- [Upstream](https://github.com/mozilla/readability)
- [License notice](https://github.com/mozilla/readability/blob/main/LICENSE.md)
- Local copies: `licenses/readability-LICENSE.md`, `licenses/Apache-2.0.txt`.

## Sign in with ChatGPT DevKit

The official `@siwc/local` 0.1.0 integration is vendored at `vendor/siwc-local` and used as a server workspace dependency, pinned to `f723814abdccec135b519c451fb6e1992ee5e933`. Copyright 2026 OpenAI. Licensed under the **Sign-in with ChatGPT DevKit Noncommercial License v1.0**, separately from Easynews's MIT source. Independently authored software calling its interface is distinguished from modifications to the DevKit in its license. Configuration changes and optional Responses reasoning-effort/web-search forwarding and request-local event callbacks in `src/types.ts` and `src/responses.ts` retain the upstream license and are marked in `vendor/siwc-local/UPSTREAM.md`. Authentication, credential storage, and upstream tests are unchanged.

- [Official repository](https://github.com/openai/sign-in-with-chatgpt-devkit)
- [Exact license](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/f723814abdccec135b519c451fb6e1992ee5e933/LICENSE)
- Retained license: `licenses/siwc-devkit-LICENSE.txt`.

Any integration must preserve this license and applicable upstream notices. OpenAI trademarks and branded assets have separate conditions and are not MIT assets. No OpenAI fonts or logos are currently bundled by Easynews. Commercial use of the DevKit requires reviewing its license and OpenAI service terms; Easynews's MIT license does not grant those rights.

`vendor/siwc-local/LICENSE` and its unmodified upstream `THIRD_PARTY_NOTICES.md` accompany the SDK build. Its runtime dependencies are jose (MIT), proper-lockfile (MIT), graceful-fs (ISC), retry (MIT), and signal-exit (ISC), with licenses retained in their installed packages and upstream notices. The upstream notice inventories fonts/assets from the full DevKit that are not included in Easynews.

Development tools and installed dependencies retain the licenses distributed with their packages. Their package licenses must accompany any redistribution of those components.
