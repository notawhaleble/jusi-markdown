# jusi-markdown

A standalone Markdown reader for **jusi-neovim**. Read a typeset document while
using Neovim motions, search, visual selections, and yank on its readable text.
Cursor and selection highlights follow **individual characters**, including
inside formatted prose, links, tables, and syntax-highlighted code.
LaTeX formulas are typeset with KaTeX; their TeX source remains searchable and yankable.

## Install

Requires the graphical jusi-neovim host with managed worker API v1,
`source.navigate.cursor`, `source.navigate.selection`, and `surface.actions`, Neovim 0.11+, and
Node.js 22.13+ (or 24+).

```sh
npm ci --ignore-scripts
```

With lazy.nvim:

```lua
{
  dir = '/Users/niku/Documents/dev/jusi-markdown',
  main = 'jusi_markdown',
  build = 'npm ci --ignore-scripts',
  opts = {},
}
```

Keep the host runtime on runtimepath as described in jusi-neovim's installation
instructions. For native packages, put this entire checkout, with dependencies,
under `stdpath('data')/site/pack/jusi/start/jusi-markdown`.

The old optional `jusi-markdown.nvim` test package uses the same provider/module
name. Disable that package when installing this replacement.

To try this checkout in a running jusi-neovim:

```vim
:lua vim.opt.runtimepath:append('/Users/niku/Documents/dev/jusi-markdown'); require('jusi_markdown').setup()
:JusiMarkdown /Users/niku/Documents/dev/jusi-markdown/examples/demo.md
```

## Reading

`:JusiMarkdown /path/to/document.md` opens a new presentation without changing
the source or the previous buffer. Paths with spaces use the whole argument;
do not add shell quotes. Standard Ex filename expansion applies to `%` and `#`;
use the Lua API for arbitrary literal paths:

```lua
require('jusi_neovim').open('markdown', '/path/to/document.md')
```

`:JusiOpen markdown /path/to/document.md` also works.
`:JusiMarkdown! /path/to/document.md` opens with the text layer disabled.

| Input | Result |
| --- | --- |
| `h`, `j`, `k`, `l`, word motions, `/` | Native Neovim navigation and search; reveal the current character |
| `v`, `V`, `Ctrl-V` | Characterwise, linewise, and blockwise selection projected onto the page |
| `y` | Yank readable text; formulas retain TeX source and math delimiters |
| `Enter`, `Ctrl-J` | Follow the link at the cursor, or the first link on the current visible line |
| `i` | Rich mode for scrolling and clicking links |
| `Ctrl-\` then `Ctrl-N` | Return to Neovim text navigation |
| `Ctrl-Q` or `:JusiClose` | Close the presentation and its worker |

The page has no header. The current filename appears in Neovim's status line,
including after following a relative Markdown reference. Links such as
`docs/1.0/installation.md`, `../README.md`, and `chapter.md#section` open the
referenced document in the same reader. The file is loaded only when followed;
missing/invalid files report an error while retaining the current document.
Relative Markdown links may resolve outside the current file's directory.

Internal fragment links move the text cursor and scroll to headings. HTTP(S) references open a normal
jusi-web tab; the Markdown reader remains open. Mouse clicks and Enter/Ctrl-J use
the same link routing. Among several links on a line, the cursor's link wins.
Rich-mode scrolling does not move the Neovim cursor. The host's text retry control
rebuilds text from the same snapshot.

## Markdown support

- ATX/setext headings, paragraphs, nested lists, block quotes, and horizontal rules.
- Emphasis, strong text, strikethrough, inline code, reference links, and autolinks.
- Tables with alignment and horizontal scrolling.
- Task lists with readable `☐` / `☑` markers.
- Fenced and indented code; common declared languages receive syntax highlighting.
- Internal heading links, relative Markdown references, and automatic light/dark styling.
- Local PNG, JPEG, GIF, WebP, and AVIF images with readable captions.
- Inline and display LaTeX mathematics, rendered offline with bundled KaTeX fonts.

Images must resolve inside the Markdown file's directory or its descendants,
including after resolving symlinks. They are snapshotted at open. Remote images,
SVGs, missing images, and images outside that directory retain their captions.
Each image is limited to 16 MiB; all image snapshots together to 32 MiB.

Raw HTML is displayed as text. Mermaid, footnotes, frontmatter metadata,
embedded HTML, editing, automatic source refresh, saved reading progress, and
navigation to non-Markdown local files are not implemented. Task markers are read-only.
Close and reopen to read source edits. This is a Markdown reader, not a claim of
complete GFM extension conformance.

### Formulas

Use `$...$` or `\(...\)` inline. Put `$$...$$` or `\[...\]` on their own
lines for display equations; `math` code fences also render as display math.
For example:

```markdown
For $x > 0$, the derivative is \(f'(x) = 2x\).

$$
\begin{aligned}
\int_0^1 x^2\,dx &= \left[\frac{x^3}{3}\right]_0^1 \\
                 &= \frac{1}{3}.
\end{aligned}
$$
```

Fractions, roots, sums, integrals, matrices, cases and aligned derivations use
[KaTeX's supported commands](https://katex.org/docs/supported), rather than a full
LaTeX document/preamble. Macros are local to each formula. Code spans, ordinary
code fences and indented code remain literal. Escape currency dollars as `\$`;
single-dollar math cannot start/end with whitespace or close before a digit.
Malformed or unsupported formulas stay visible as escaped TeX source.

Math CSS and fonts are served locally from the installed dependency; no CDN or
network connection is needed for reading. Untrusted commands cannot insert HTML,
links or external resources, and macro expansion and formula sizes are bounded.
Wide display equations scroll horizontally and follow the light/dark theme.
Open [examples/math.md](examples/math.md) for a formula-rich sample.

## Character projection

One parser model produces rendered text runs. Chromium measures those runs after
layout and groups them into **visible text lines**, including lines that wrap
inside headings, paragraphs, lists, and table cells. `$` goes to the last character
of the current rendered line; `j` and `k` move between rendered rows. Table cells
on the same visual row are separated by tabs in the extracted text.

Window/buffer geometry changes trigger a debounced measurement and document
reload at the same private URL. The host issues a new document revision and
rebuilds the text buffer. The cursor's run/character position is restored where
possible. A new linked document instead starts at its top or named fragment.

The worker maps Neovim's UTF-8 byte columns to UTF-16 positions in those exact runs.
The page resolves them into DOM `Range` objects, including nested syntax spans,
and uses Chromium's measured rectangles. It does not divide a word or line into
equal-width boxes. Projection adjusts to wrapping, scrolling, and resizing.

A formula is an atomic visual object: any cursor or selection inside its TeX
source highlights the whole rendered formula. The text buffer retains delimiters,
commands and source line breaks (including comments), rather than duplicating
KaTeX's visual and accessibility text. Multiline display formulas therefore have
one buffer row per source line, all projecting to the same formula. A `math`
fence is exposed as a `$$...$$` formula when yanked.

This handles Cyrillic, CJK, emoji, entities, and formatting boundaries. Fonts may
shape several Unicode code points into a single grapheme or ligature; their
visual ownership follows Chromium's text geometry. Blank rows and zero-width
characters may have no visible rectangle. Neovim owns inclusive/exclusive,
reverse, linewise, and block selection semantics. The host limits selection
projection to 512 rows; an unrepresentable selection suppresses highlights.

Soft source breaks remain visible line breaks, and additional visual wraps become
additional text rows. Code retains indentation and scrolls horizontally when
needed. Prose trailing wrap whitespace is excluded from the text row. List bullets
and numbering are layout decorations; task markers and image captions belong to
the readable text.

## Configuration and lifecycle

```lua
require('jusi_markdown').setup({
  node = 'node',             -- executable name or absolute path
  text_layer = 'auto',       -- 'auto' or 'off'
})
```

`vim.g.jusi_markdown` accepts the same options before package startup. Explicit
`setup(opts)` replaces defaults for future opens; `setup()` preserves an existing
configuration.

Input must be a regular UTF-8 file of at most 1 MiB, without NUL. Extracted text
is limited to the host's 10,000 rows / 512 KiB, plus a 900,000-byte serialized
document budget. Oversized extraction reports an error while retaining the rich
page. Extraction waits for the current page's measured layout; canceled or stale
requests cannot publish it. Startup and extraction each have a 30-second host
timeout. Layout requests are limited to 2 MiB and 100,000 mapped fragments.

Each presentation serves its immutable snapshot and explicitly referenced assets
at a random loopback URL. It does not serve a directory or expose Neovim IPC to
the document. The page has a restrictive CSP. Navigation checks the complete
document ticket and a monotonic sequence; stale results and navigation cannot
restore an obsolete highlight. Closing the buffer or losing the owner pipe
terminates the worker and releases its HTTP server and image memory. A private
provider-owned metadata file carries the current filename, revision-checked
cursor restoration, and explicitly followed web links to Lua. The page cannot
write this file or supply arbitrary host operations; the worker resolves links
only from its parsed document. Provider disposal removes the metadata directory.

## Development

```sh
npm test
npm run test:host
npm run test:electron
JUSI_MARKDOWN_REVIEW_FILE=/path/to/jusi/README.md npm run test:electron
```

Host tests use `../jusi-neovim` by default; set `JUSI_NEOVIM_ROOT` to override it.
`JUSI_NVIM` selects the headless test's Neovim binary. Electron tests require a
desktop session, the host's installed Electron, and its existing `dist/` build.
Tests use disposable profiles and a copied native-package installation; they do
not alter editor configuration. Screenshots are written to `.local/review/`.

The provider follows the host's Markdown conformance package and the sibling
`jusi-pdf` installation/lifecycle patterns (MIT, same author). Parsing uses
[markdown-it](https://github.com/markdown-it/markdown-it); code coloring uses
[highlight.js](https://github.com/highlightjs/highlight.js); mathematics uses
[KaTeX](https://katex.org/).
