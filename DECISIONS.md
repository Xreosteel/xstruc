# X Struc decisions

Decisions Baji has made. Build to these; don't re-ask them. Newest first. A build run that needs a decision not listed here adds a question to the planning doc instead of guessing.

## 2026-11-04

- **Primary user: site crews.** Leading hands, foremen and fixers building the reo from the model. Site-facing features lead the backlog; scheduling-office and bending-machine features follow.
- **Next site feature:** a layer-by-layer fixing view for a tablet (big type, one layer at a time, tap a bar for mark, setout and laps), then per-layer placing drawings.
- **Set-downs:** Z-bar splices across shallow set-downs, cranked at 1:6 or flatter with a 300 minimum crank (SRIA TN5).
- **Layer direction:** no default. If a mat callout does not say which way it runs (E-W / N-S), the inputs panel reports an error and asks; the model is not built with a guessed direction.
- **Shape codes:** CIA/ARC letters (S, L, LL, U, T, CC, ZL …). Schedule dimensions are to the bar extremities, cog included.
- **Hook and cog values:** AS 3600-derived (Cl 17.2.3.2 pins, Cl 13.1.2.7 hooks/cogs) as the default. A per-shop allowance table can come later as a setting.
- **Thin-slab cogs:** the longest cog that fits, flagged on the bar, the mark and the model until the engineer confirms the cog length.
- **Laps:** where a drawing's general notes give a lap table, use the engineer's numbers and flag any that differ from the AS 3600 Section 13 formula; computed laps round up to 50 mm; cd = min(cover, half clear spacing) with the governing value shown. The flat "lap, all bars" input stays the project default until a table is entered.
- **Machine files:** BVBS export only (no import) for now. Grade strings are a per-shop setting, default `500N` / `500L` / `250N`. The shops Baji knows schedule in Excel; their bending machines are not known yet.
