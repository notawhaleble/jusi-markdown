# Validation

Validated locally on 2026-10-31 with Node 24.10.0 and the sibling
`../jusi-neovim` runtime and Electron build. No host source changes were needed.

| Check | Result |
| --- | --- |
| `npm test` | Exit 0; 10 tests covering parser/mapping, measured row validation, UTF-8, link ownership, layout generations, image isolation, worker lifecycle, pending extraction cancellation, stale navigation/actions, relative references and failure handling |
| `npm run test:host` | Exit 0; copied native package, configuration, literal file paths, managed startup, fixture layout publication, filename and keybindings, read-only buffer, Unicode search/yank, stale publication, text-off, cleanup |
| `JUSI_MARKDOWN_REVIEW_FILE=/Users/niku/Documents/dev/jusi/README.md npm run test:electron` | Exit 0; real Chromium layout, `$` stays at the current rendered line's right edge, `j` changes visible rows, width/height/split rebuilds, selections, code/table projection, local/fragment/web references, Enter/Ctrl-J, filename updates, new document cursor reset, images, text-off and cleanup |
| `npm audit --omit=dev` | Exit 0; zero reported vulnerabilities |

Visual review used saved screenshots after waiting for projection publication
and resized guest layout:

- `.local/review/markdown-characters.png`: exact emoji cursor with formatted prose.
- `.local/review/markdown-wrapped-selection.png`: line selection across wrapping
  and inline formatting after resize.
- `.local/review/markdown-readme-reference.png`: the supplied README's installation
  reference opened at its top, with `installation.md` in the native status line.

Screenshots were inspected. Live manual computer-use review was not run;
the interactions above were exercised by automated Electron input/assertions.
Logs are in `.local/review/{unit,host,electron}.log`.

The host emitted `MaxListenersExceededWarning` for WebContents destroyed
listeners, and Electron logged GPU mailbox diagnostics during tab transitions.
Neither failed the assertions; no host changes were made in this provider task.

The first graphical harness attempt stalled before application readiness because
its entry module awaited startup at top level. Moving startup into an invoked
async function fixed the harness. An initial screenshot also exposed insufficient
waiting for projection painting and resize; the test now waits for both. These
issues were corrected before the successful checks above. The rendered-line
follow-up also caught delayed cursor restoration overriding a motion after a
split rebuild. Restoration metadata is now written before the text result and
applied from the native buffer-change callback. The split regression passes.
