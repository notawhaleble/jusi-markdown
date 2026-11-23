# A document, two ways to read

Hello **café** — Привет 文 😀. Move character by character, then select part of this sentence.

The rich page and the Neovim text buffer share the same readable text. Try **bold**, *italic*, ~~struck text~~, `inline code`, and [a web reference](https://commonmark.org).

## Reading notes

- [x] Character-wise cursor projection
- [x] Visual selections across formatted text
- [ ] Write the next chapter

> A good reader should keep typography and ordinary editor motions together.
> Search, select, and yank using Neovim.

### A little code

```javascript
const greeting = "Привет, café 😀";
function welcome(name) {
  return `${greeting}, ${name}!`;
}
```

| Feature | Text buffer | Rich surface |
| :--- | :--- | :--- |
| Unicode | UTF-8 byte columns | Real glyph positions |
| Selection | Native Neovim semantics | Exact DOM text ranges |
| Images | Readable caption | Local raster images |

## References

Follow [Reading notes](#reading-notes) with Enter, Ctrl-J, or a rich-mode click.

1. Markdown formatting is removed from extracted prose.
2. Code retains spaces and indentation.
3. Raw HTML stays inert: <script>alert('never executed')</script>.

---

An unavailable image keeps its caption: ![A quiet landscape](missing.png)
