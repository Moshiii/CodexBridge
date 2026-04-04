# AutoAide Web Console Visual Style

## Goal

Define a visual direction for the AutoAide web console that feels:

- hard sci-fi
- cyberpunk-adjacent
- terminal-native
- operational
- credible for daily use

The target is not a flashy concept piece.
The target is a durable product surface that still feels distinctive.

## Core Direction

The right visual direction for AutoAide is:

`industrial sci-fi terminal`

Not:

- nightclub cyberpunk
- game HUD overload
- glossy SaaS dashboard
- vaporwave neon concept art

This should feel like:

- an autonomous operations console
- a local control room
- a machine-facing workspace for a human operator

## Style Formula

Use this ratio as the design constraint:

- 80% terminal discipline
- 15% hard sci-fi control panel language
- 5% cyberpunk accent

This balance matters.

If the cyberpunk percentage goes too high:

- readability drops
- information hierarchy collapses
- the product starts to feel like a poster instead of a tool

## Visual Thesis

AutoAide should look like:

- a system you trust to run long-lived work
- a console for bots, sessions, goals, schedules, and logs
- a machine room interface with personality

It should not look like:

- a crypto dashboard
- a gaming overlay
- a hacker movie parody

## Color System

### Base palette

Use a dark graphite-green base instead of pure black.

Recommended tokens:

```text
--bg-0: #09100e
--bg-1: #0d1512
--bg-2: #111a17
--panel-0: #121d19
--panel-1: #16231f
--panel-2: #1a2924
--line-0: #20332d
--line-1: #2a433b
--text-0: #e4f2ec
--text-1: #b8cbc3
--text-2: #7e958d
```

### Accent colors

Primary accent should be a machine signal color, not a rainbow.

Recommended primary accent options:

- acid green: `#7CFF5B`
- signal mint: `#37F3C8`

Recommended secondary accents:

- amber: `#F6B73C`
- warning orange: `#FF8A3D`
- fault red: `#E85D4F`

### Accent usage rules

Primary accent should be used for:

- active mode
- current bot
- running state
- selected row
- focus rings
- command buttons

Amber should be used for:

- attention
- stale state
- paused state

Red should be used only for:

- failure
- destructive actions
- fault logs

Do not use:

- bright purple gradients
- rainbow neon combinations
- multiple glowing accent colors in one panel

## Typography

The type system should feel machine-like but still usable.

### Recommended pairing

1. UI labels and headings

Use a condensed or industrial sans.

Examples:

- Eurostile
- Microgramma-style alternatives
- Rajdhani
- Oxanium
- IBM Plex Sans Condensed

2. Body text and logs

Use a monospaced font or near-monospace.

Examples:

- IBM Plex Mono
- JetBrains Mono
- Berkeley Mono
- Geist Mono

### Typography rules

- headings should feel structural and technical
- logs and config should always be monospace
- avoid rounded, friendly consumer app fonts
- avoid editorial serif styles

## Surfaces

Panels should feel engineered, not card-based in the usual SaaS sense.

### Surface treatment

Prefer:

- low-contrast dark panels
- subtle inner borders
- restrained inset highlights
- slight tonal stacking between layers

Avoid:

- bright white cards
- soft pastel panels
- blurred glassmorphism
- large shadows as the main separation tool

### Border language

Use borders as part of the sci-fi feel.

Good patterns:

- thin technical outlines
- segmented headers
- corner accents
- subtle notches

Bad patterns:

- thick ornamental frames everywhere
- decorative lines with no hierarchy
- excessive HUD ornament

## Lighting And Glow

Glow should exist, but only as a signal.

Use glow for:

- active selection
- current bot
- keyboard focus
- running state

Do not use glow for:

- every border
- every header
- all buttons at once

### Recommended glow behavior

- small radius
- low blur
- limited spread
- color tied to semantic state

Example principle:

```text
Selected row: thin accent border + faint edge glow
Primary button: accent fill + restrained highlight
Danger button: no glow by default, glow only on hover/focus
```

## Texture And Atmosphere

To get terminal and sci-fi atmosphere without ruining usability, add only subtle environmental texture.

Allowed:

- faint scanlines
- low-opacity grid
- soft noise layer
- dark gradient falloff
- occasional pulse on active indicators

Not allowed:

- aggressive glitch animation
- VHS distortion over content
- animated interference behind text
- constant flicker

The atmosphere should be something the user notices after a few seconds, not something blocking the first read.

## Motion

Motion should feel like system response, not decorative animation.

Good motion:

- row selection pulse
- panel reveal
- terminal cursor blink
- log tail update flash
- status indicator pulse

Bad motion:

- floating cards
- continuous shimmer on everything
- large parallax
- random glitch loops

### Motion principle

Every animation should answer one of these:

- what changed
- what is active
- what is running
- what needs attention

## Component Language

### Top header

Should feel like a command deck header.

Recommended traits:

- compact
- high-information
- one strong title
- status strip on the right

### Left rail

Should feel dense and machine-operator oriented.

Recommended traits:

- darker than center content
- compact bot rows
- active bot clearly bracketed or highlighted
- actions grouped by lifecycle

### Object list

This is the most terminal-like zone.

Recommended traits:

- dense rows
- clear active row highlight
- status chips only when useful
- no oversized cards

### Detail pane

Should be calmer than the list pane.

Recommended traits:

- more breathing room
- strong section dividers
- one primary work surface
- one inspector surface

### Diagnostics strip

Should feel like a live machine console.

Recommended traits:

- monospaced
- slightly darker than main workspace
- active tail behavior
- fault lines can tint subtly red or amber

## Iconography

Icons should be technical and spare.

Prefer:

- line icons
- squared geometry
- minimal terminal-like symbols

Avoid:

- playful rounded icons
- emoji-like iconography
- too many decorative symbols

## Recommended Visual Metaphors

Use these metaphors:

- signal
- module
- bus
- channel
- runtime
- process
- control room

Avoid these metaphors:

- social app
- creative whiteboard
- gaming inventory
- fintech wallet

## Readability Rules

This section is non-negotiable.

If the design becomes harder to scan than the current UI, it is wrong even if it looks cooler.

Always preserve:

- strong contrast between text and panel
- monospace readability in logs
- obvious selection state
- obvious error state
- obvious running state

Never sacrifice:

- config readability
- log readability
- form readability
- code/textarea legibility

## Do / Don't

### Do

- keep the palette narrow
- use one main signal color
- make the interface feel engineered
- let logs and config stay plain where needed
- use light sci-fi framing, not costume
- make the terminal feeling structural, not decorative

### Don't

- flood the interface with neon glow
- use purple-pink-blue gradients as the base look
- turn every panel into a futuristic prop
- over-animate status indicators
- make text look like a movie title sequence

## Suggested CSS Token Seed

```text
--bg-0: #09100e;
--bg-1: #0d1512;
--bg-2: #111a17;
--panel-0: #121d19;
--panel-1: #16231f;
--panel-2: #1a2924;
--line-0: #20332d;
--line-1: #2a433b;
--text-0: #e4f2ec;
--text-1: #b8cbc3;
--text-2: #7e958d;
--accent-0: #37f3c8;
--accent-1: #7cff5b;
--warn-0: #f6b73c;
--danger-0: #e85d4f;
--shadow-soft: 0 12px 40px rgba(0, 0, 0, 0.35);
--glow-accent: 0 0 18px rgba(55, 243, 200, 0.16);
```

## Visual Target In One Sentence

AutoAide should feel like:

`a trusted local bot operations console built inside a hard-sci-fi terminal environment`

## Final Recommendation

Commit to:

- dark industrial base
- narrow accent palette
- monospace-forward presentation
- restrained glow
- machine-console hierarchy

The visual success condition is not:

- "this looks very cyberpunk"

The real success condition is:

- "this feels like a serious autonomous systems console with cyberpunk DNA"
