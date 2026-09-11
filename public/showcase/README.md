Pictures for the top of the purchase screen.

Drop image files in here, then name them in `src/state/showcase.ts` — the
`src` of each frame is a filename relative to this folder. A frame whose
`src` is still `null` draws a plain panel with its own name on it, so a
half-filled set reads as half filled rather than as a broken image.

The gallery is one frame per screen, roughly the top 46% of the phone, and
each picture is drawn `cover` — so it is cropped to fill rather than letterboxed.
Compose for a tall crop and keep anything that matters away from the bottom
third, which the page fades up over.
