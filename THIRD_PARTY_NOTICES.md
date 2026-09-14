# Third-party notices

Workflow-authored code is provided under the MIT licence in `LICENSE`.
The following notices cover the identified embedded third-party icon geometry.
They must remain with source copies and packaged updater assets.

## Lucide icons

`runtime/preload.cjs` and the retained parked preload embed geometry corresponding to
the following Lucide icons. Workflow supplies the surrounding SVG attributes,
accessibility attributes and native CSS classes.

| Workflow glyph | Upstream icon | Pinned revision |
| --- | --- | --- |
| plus | plus | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| gauge | gauge | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| help | circle-question-mark | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| back | chevron-left | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| grip | grip-vertical | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| lock | lock-keyhole | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| hidden | eye-off | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| eye | eye | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| trash | trash-2 (0.468.0) | f12b0de177fbc2a6795e99be065887e72b237123 |
| section disclosure | chevron-right | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| section back | arrow-left | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| dropdown disclosure | chevron-down | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| upward disclosure | chevron-up | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |
| collapsed group | minus | a79b2d131dab2bf20cb224bd0937b439a9c4fa99 |

These are source correspondences verified by geometry, not claims about the
historical route by which the icons entered Workflow.

Source: https://github.com/lucide-icons/lucide/tree/a79b2d131dab2bf20cb224bd0937b439a9c4fa99/icons

The complete licence from that revision follows, including its Feather notice:

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Legacy trash-2 geometry

Source: https://github.com/lucide-icons/lucide/blob/f12b0de177fbc2a6795e99be065887e72b237123/icons/trash-2.svg

The complete licence from the matching 0.468.0 revision is retained below as well:

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Packaged dependencies and scope

Packaged dependencies retain their own licence and notice files under
`node_modules`. This document does not replace those notices or grant a licence
to Codex itself, captured native Codex HTML, or other native assets. A public
icon licence must not be treated as permission for unrelated captured material.

Native Codex glyphs used by the current runtime are loaded from the user's local
installation and are not included in Workflow's source or updater payload. See
`docs/NATIVE_ASSET_PROVENANCE.md` for that bounded distinction.
