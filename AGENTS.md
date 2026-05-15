# Codex Notes for This Workspace

## Browser testing

- The Codex in-app browser Node runtime must use the bundled Codex runtime, not the system Node at `C:\Program Files\nodejs\node.exe` when that system Node is too old.
- `file://` URLs are blocked by Browser Use URL policy. Use an HTTP URL for local app testing.
- Do not rely on shell-started background servers such as `Start-Process python -m http.server` across tool calls. In this environment they may be cleaned up after the shell command returns, which makes the browser report `ERR_CONNECTION_REFUSED`.
- If a local server is needed for in-app browser testing, start it inside the Node REPL/browser runtime so it remains reachable by the in-app browser during that session.
- If in-app browser navigation lands on its generated `data:text/html` error page, open a fresh tab before retrying. Reusing the error tab can trigger URL policy blocks.
- In-app browser DOM inspection works for `http://127.0.0.1:<port>` when the server is reachable, but screenshot capture may time out with `Page.captureScreenshot`.
- Chrome DevTools is the stable screenshot fallback. The working config uses:
  - profile: `D:\Git\Idle Sand Sorting\.codex-browser\chrome-devtools-profile`
  - npm cache: `D:\Git\Idle Sand Sorting\.codex-browser\npm-cache`
- Verified screenshot fallback output path used during debugging:
  - `D:\Git\Idle Sand Sorting\.codex-browser\localhost-8765-repro.png`
