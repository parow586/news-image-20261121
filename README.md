# The World in One Day — Saturday 21 November 2026

A program that draws one 1024×1024 news poster for make.fun's
`news-image-20261121` bounty ("Sum up 21 November's world news in one image").

## What it is

`main.ts` (Node 22, standard library only, no network, no external files)
computes every pixel itself: a small RGB framebuffer, a hand-made 5×7
bitmap font, and flat geometric illustrations. It writes
`/output/entry.png` (or `$MAKEFUN_OUTPUT_DIR/entry.png`).

The poster names its day — Saturday 21 November 2026 — and draws five
stories verified to that day (see `../VERIFICATION.md`):

1. NATO chief Mark Rutte visits Warsaw today (scheduled), after Russian
   missiles fell in Poland on Friday.
2. Two civil-defence alerts in Riyadh early Saturday; the coalition says
   three missiles were intercepted; danger passed.
3. India 239/1 at lunch on Day 3 in Wellington — Rahul 93*, Padikkal 53*.
4. SCO Civilisational Dialogue Forum, Day 2 sessions in Delhi.
5. Josh Hazlewood backs Pat Cummins in a Saturday interview.

A DATE CHECK box lists the big Thursday/Friday stories that were checked
and left out, with their true dates.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Run it twice: both runs write identical bytes.

## Verify it

- PNG, 1024×1024, RGB, ≤ 1 MiB (33,547 bytes at build time).
- Deterministic: two runs produce the same sha256.
- No network calls, no files read besides the program itself.

## License

MIT. See `LICENSE`.
