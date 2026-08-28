#!/usr/bin/env python3
"""Generate simple flat-line ribbon icons for ONEXUS Revit add-in buttons,
matching the existing logo's blue (#097DCD) network-hub palette.

Requires: pip install cairosvg
Run from anywhere; writes into this same Assets/icons/ folder:

    python3 generate_icons.py

Each entry in ICONS is one glyph's SVG body, rasterized to both a 32x32
(LargeImage) and 16x16 (Image) PNG for OnexusApplication.LoadIcon. Edit an
SVG string below and re-run to update a button's icon.
"""
import math
import os

import cairosvg

BLUE = "#097DCD"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

SW = 2.2  # stroke width at 32px canvas

WRAP = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<g fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">
{body}
</g>
</svg>"""


def gear_teeth(cx, cy, r_outer, r_inner, count):
    parts = []
    for i in range(count):
        a = 2 * math.pi * i / count
        x1 = cx + r_inner * math.cos(a)
        y1 = cy + r_inner * math.sin(a)
        x2 = cx + r_outer * math.cos(a)
        y2 = cy + r_outer * math.sin(a)
        parts.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}"/>')
    return "\n".join(parts)


ICONS = {
    # Open a previously saved ONEXUS graph file.
    "open_file": """
<path d="M5 11 L5 25 L27 25 L27 12 L15 12 L13 9 L5 9 Z"/>
""",
    # Explore Elements: search/inspect any selection.
    "explore_elements": """
<circle cx="13" cy="13" r="7"/>
<line x1="18.3" y1="18.3" x2="26" y2="26"/>
<circle cx="13" cy="13" r="1.6" fill="{blue}" stroke="none"/>
""",
    # Room Graph: a spatial boundary with a relationship graph inside it.
    "room_graph": """
<rect x="4.5" y="5.5" width="23" height="20" rx="1.5"/>
<line x1="11" y1="13" x2="21" y2="20"/>
<circle cx="11" cy="13" r="3.1" fill="{blue}" stroke="none"/>
<circle cx="21" cy="20" r="3.1" fill="{blue}" stroke="none"/>
""",
    # 3D Rooms: an isometric room volume.
    "room_geometry": """
<path d="M16 4 L26 9 L16 14 L6 9 Z"/>
<path d="M6 9 L16 14 L16 26 L6 21 Z"/>
<path d="M26 9 L16 14 L16 26 L26 21 Z"/>
""",
    # CDI Context: export a model-context package.
    "cdi_context": """
<path d="M6 20 L6 26 L26 26 L26 20"/>
<line x1="16" y1="4" x2="16" y2="19"/>
<path d="M10 10 L16 4 L22 10"/>
<circle cx="16" cy="4" r="1.7" fill="{blue}" stroke="none"/>
""",
    # Door Types: a door leaf with a knob.
    "doors": """
<rect x="9" y="5" width="14" height="22" rx="0.6"/>
<circle cx="19" cy="16.5" r="1.4" fill="{blue}" stroke="none"/>
""",
    # Proximity Links: a device with expanding proximity rings.
    "proximity_links": """
<circle cx="12" cy="20" r="1.8" fill="{blue}" stroke="none"/>
<path d="M16 20 A7 7 0 0 0 12 13.6"/>
<path d="M19.5 20 A10.5 10.5 0 0 0 12 9.5"/>
<path d="M23 20 A14 14 0 0 0 12 5.5"/>
""",
    # Parameters: three adjustable sliders.
    "parameters": """
<line x1="6" y1="9" x2="26" y2="9"/>
<line x1="6" y1="16" x2="26" y2="16"/>
<line x1="6" y1="23" x2="26" y2="23"/>
<circle cx="11" cy="9" r="2.3" fill="{blue}" stroke="none"/>
<circle cx="21" cy="16" r="2.3" fill="{blue}" stroke="none"/>
<circle cx="15" cy="23" r="2.3" fill="{blue}" stroke="none"/>
""",
    # MEP Systems: one piece of equipment distributing to two terminals.
    "mep": """
<line x1="16" y1="9.5" x2="9" y2="21"/>
<line x1="16" y1="9.5" x2="23" y2="21"/>
<rect x="12" y="4.5" width="8" height="6.5" rx="1"/>
<circle cx="9" cy="23" r="2.8" fill="{blue}" stroke="none"/>
<circle cx="23" cy="23" r="2.8" fill="{blue}" stroke="none"/>
""",
    # Sheets & Views: stacked drawing sheets (back sheet peeking out, then the
    # front sheet with its own content lines drawn on top).
    "sheets": """
<rect x="9.5" y="7.5" width="16" height="20" rx="0.6"/>
<rect x="6.5" y="4.5" width="16" height="20" rx="0.6"/>
<line x1="9.5" y1="10.5" x2="19.5" y2="10.5"/>
<line x1="9.5" y1="14.5" x2="19.5" y2="14.5"/>
<line x1="9.5" y1="18.5" x2="16" y2="18.5"/>
""",
    # Set Folder: a gear for configuring the workspace.
    "settings": """
{teeth}
<circle cx="16" cy="16" r="8.5"/>
<circle cx="16" cy="16" r="3.4"/>
""",
}


def build(name: str) -> str:
    body = ICONS[name]
    if name == "settings":
        teeth = gear_teeth(16, 16, 12.5, 9.3, 8)
        body = body.format(teeth=teeth, blue=BLUE)
    else:
        body = body.format(blue=BLUE)
    return WRAP.format(color=BLUE, sw=SW, body=body)


def main():
    for name in ICONS:
        svg = build(name)
        svg_path = f"{OUT_DIR}/{name}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        cairosvg.svg2png(url=svg_path, write_to=f"{OUT_DIR}/{name}_32.png", output_width=32, output_height=32)
        cairosvg.svg2png(url=svg_path, write_to=f"{OUT_DIR}/{name}_16.png", output_width=16, output_height=16)
        print("built", name)


if __name__ == "__main__":
    main()
