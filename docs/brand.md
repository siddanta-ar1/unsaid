# Brand

## The mark

A speech bubble holding three dots, and the last one never left.

`apps/web/src/components/Logo.tsx` is the only version that should appear in the
product. The bubble takes `currentColor`, so it inherits the type colour beside
it; the two grey dots are knocked out to `--color-paper`, which is the page
behind them. That is what lets one asset invert correctly between themes instead
of shipping a light and a dark file that drift apart.

The third dot is coral. It is the only warm mark in the entire interface, and it
should stay that way — the moment a second thing is coral, the dot stops meaning
anything.

| File | Use |
|---|---|
| `src/components/Logo.tsx` | Everywhere inside the product |
| `src/app/icon.svg` | Favicon. At 16px the bubble turns to mush, so it reduces to the three dots |
| `public/mark.svg` | Square mark for anything outside the app |
| `public/logo.svg` | Horizontal lockup. Wordmark is live text in a serif stack — convert to outlines before sending it to a printer |

Clear space is the height of one dot on every side. Do not recolour the bubble,
do not add a gradient, and do not set the wordmark in the sans.

## Palette

From the OMX Lab sunset-over-water set. The cool half carries the interface; the
warm half is rationed.

| Token | Light | Dark | Role |
|---|---|---|---|
| `ink` | `#1F4A52` deep sea | `#EDE7E0` | Body type, buttons |
| `ink-soft` | `#445D58` slate green | `#B9C4C6` | Secondary type |
| `ink-faint` | `#54706A` | `#8FA3A3` | Captions, footnotes |
| `paper` | `#EFEAE4` | `#12262B` | Ground |
| `paper-raised` | `#F7F4EF` | `#193238` | Inputs, cards |
| `line` | `#CACCC4` mist | `#2C4249` | Rules |
| `field` | `#6C8880` | `#758F87` | Control borders |
| `ember` | `#B14A24` | `#FFBC9B` peach | Errors, focus |
| `accent` | `#FF7540` coral | `#FF7540` | The dot in the mark. Never type |

Two light values are darker than the swatch they came from: `ink-faint` and
`ember` both sit at 4.5:1 on paper rather than the 2.9:1 and 2.2:1 the raw
swatches gave. `field` clears 3:1, which is the floor for a control border. If
you add a colour, check it against paper before you commit it.

Coral is bright enough to be used badly. It is not a call-to-action colour here:
the buttons are deep sea, and the product deliberately has no accent-coloured
CTAs — someone using this at 2am does not need to be sold to.

## Themes

Both palettes live in `apps/web/src/app/globals.css`. The light one is a Tailwind
`@theme` block; the dark one is a plain `:root` override inside a
`prefers-color-scheme` media query.

That asymmetry is deliberate and load-bearing. Tailwind v4 hoists **every**
`@theme` block to the root and the last one wins, regardless of any media query
wrapping it — so a nested dark `@theme` does not conditionally override the
light palette, it replaces it for everyone. That was the previous state of this
file, and it meant the light theme had never rendered for a single visitor.
