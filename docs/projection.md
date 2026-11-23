# Rendered lines are the mapping authority

`lib/markdown.mjs` compiles a snapshot into HTML, text runs, logical source rows,
heading IDs, and links. Every readable fragment has a `data-run` element. Runs
retain Unicode text independently of inline formatting or syntax coloring.

The sandboxed `layout.js` measures individual code points using Chromium ranges.
It groups them by block and vertical overlap into visible lines, combining table
cells on the same row with separators. Adjacent ranges in the same run are
coalesced. Prose trailing whitespace is omitted; code indentation is retained.
Measurement yields periodically so large documents do not monopolize the page.

The page posts only run/UTF-16 intervals, separators, viewport dimensions, and its
page identity. `lib/layout.mjs` revalidates those intervals against the immutable
worker model, rejects broken Unicode boundaries, reconstructs UTF-8 row text and
segments, and enforces host budgets. No arbitrary guest text or source path is
accepted. Published anchors include a unique layout generation; cursor columns
refer to extracted rows, never original Markdown source offsets.

Initial extraction waits for the first measured layout. Geometry changes are
debounced. A changed layout clears projection and blocks publication until a real
reload at the advertised surface URL causes the host to issue a new ticket.
Every load gets a new page identity, so late measurements from the old page are
rejected. Neither the worker nor Lua fabricates a host revision. Font/image layout
changes remeasure; unchanged row mappings and viewport size do not reload.

`lib/projection.mjs` resolves UTF-8 cursor/selection intervals into the measured
run intervals. `viewer.js` constructs text-node ranges, including nested syntax
spans, and projects their measured rectangles. Empty/unrepresentable selections
stay empty. Geometry is remeasured on scroll and resize; highlights are clipped
inside code/table scroll regions.

Enter/Ctrl-J capture the native document revision, row, and byte column into a
provider action. This avoids racing the host's debounced cursor notification.
The worker requires a currently published matching revision, chooses the link
under the cursor (or first on that visual row), and queues the same operation used
by a rich-mode click. Local Markdown targets are loaded relative to the current
document only on an explicit follow. Failed loads retain the current snapshot.
Successful loads revoke page/layout identities before reloading the surface.

A private directory allocated by the installed Lua provider holds atomic worker
metadata: filename, a cursor-restoration target with the exact published ticket,
and explicitly followed HTTP(S) references. Restoration metadata is written
before the text result; a native buffer-change callback applies it as that exact
ticket becomes ready, avoiding a delayed timer overriding subsequent motion.
Lua opens each external request once through the
normal web provider with the original profile/privacy options. The sandbox cannot address this file. The worker chooses
URLs from parsed references; guest requests contain only link IDs. All mutating
HTTP endpoints require same-origin JSON and a current page identity. Disposal
stops the metadata timer and removes the private directory.

This uses the existing host lifecycle and provider API; there are no host source
changes. Reflow currently reloads the rich document, rather than updating the
host's text revision in place. Local document history/back-forward is not yet
implemented.
