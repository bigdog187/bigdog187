#!/usr/bin/env python3
"""
Instagram ad generator for Weiley Electrical (wyelec.com.au).

Produces four 1080x1080 PNG ad creatives (plus source SVGs) built from the
company's real brand details: tagline, services, est. 1986, Dubbo / Central
West NSW service area, ISO certifications and contact phone.

Run:  python3 generate_ads.py
"""

import os
import html
import cairosvg

# ----------------------------------------------------------------------------
# Brand system
# ----------------------------------------------------------------------------
NAVY      = "#0B2138"   # deep brand navy
NAVY_2    = "#102B49"   # lighter navy for gradient
NAVY_3    = "#0A1B2E"   # near-black navy
AMBER     = "#FFC21A"   # electric amber / yellow accent
AMBER_2   = "#FFD24D"
WHITE     = "#FFFFFF"
MIST      = "#C9D6E5"   # muted blue-grey text
LINE      = "#1C3A5C"   # subtle circuit line colour

FONT = "DejaVu Sans, Liberation Sans, sans-serif"

SIZE = 1080
OUT  = os.path.dirname(os.path.abspath(__file__))


def esc(s):
    return html.escape(str(s), quote=True)


# ----------------------------------------------------------------------------
# Reusable SVG pieces
# ----------------------------------------------------------------------------
def bolt(cx, cy, scale=1.0, fill=AMBER, opacity=1.0):
    """A lightning-bolt mark centred roughly on (cx, cy)."""
    # path drawn in a ~100 x 150 box, then translated/scaled
    return (
        f'<g transform="translate({cx},{cy}) scale({scale}) translate(-50,-75)">'
        f'<path d="M58,4 L20,84 L46,84 L32,146 L92,60 L60,60 Z" '
        f'fill="{fill}" opacity="{opacity}"/></g>'
    )


def circuit_bg(seed_lines):
    """Subtle circuit-trace decoration. seed_lines is a list of path 'd' strings."""
    parts = []
    for d in seed_lines:
        parts.append(f'<path d="{d}" fill="none" stroke="{LINE}" stroke-width="3"/>')
    # nodes
    return "".join(parts)


def logo_lockup(x, y, scale=1.0, on_dark=True):
    """Weiley Electrical wordmark with bolt badge. Anchored top-left at (x,y)."""
    txt = WHITE if on_dark else NAVY
    sub = AMBER
    s = scale
    badge = (
        f'<g transform="translate({x},{y})">'
        f'<rect x="0" y="0" width="{72*s}" height="{72*s}" rx="{16*s}" fill="{AMBER}"/>'
        f'{bolt(36*s, 36*s, scale=0.42*s, fill=NAVY)}'
        f'</g>'
    )
    words = (
        f'<g transform="translate({x + 88*s},{y})">'
        f'<text x="0" y="{30*s}" font-family="{FONT}" font-size="{30*s}" '
        f'font-weight="bold" letter-spacing="{1.5*s}" fill="{txt}">WEILEY</text>'
        f'<text x="0" y="{62*s}" font-family="{FONT}" font-size="{20*s}" '
        f'font-weight="bold" letter-spacing="{7.6*s}" fill="{sub}">ELECTRICAL</text>'
        f'</g>'
    )
    return badge + words


def footer(web="wyelec.com.au", phone="02 6884 9292"):
    """Consistent bottom contact bar."""
    y = 1012
    return (
        f'<rect x="0" y="980" width="{SIZE}" height="100" fill="{NAVY_3}"/>'
        f'<rect x="0" y="980" width="{SIZE}" height="4" fill="{AMBER}"/>'
        f'<text x="64" y="{y+18}" font-family="{FONT}" font-size="30" font-weight="bold" '
        f'fill="{WHITE}">{esc(web)}</text>'
        f'<text x="{SIZE-64}" y="{y+18}" text-anchor="end" font-family="{FONT}" '
        f'font-size="30" font-weight="bold" fill="{AMBER}">{esc(phone)}</text>'
    )


def defs():
    return (
        '<defs>'
        f'<linearGradient id="navy" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{NAVY_2}"/>'
        f'<stop offset="1" stop-color="{NAVY_3}"/>'
        f'</linearGradient>'
        f'<linearGradient id="amber" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{AMBER_2}"/>'
        f'<stop offset="1" stop-color="{AMBER}"/>'
        f'</linearGradient>'
        '</defs>'
    )


def frame(inner):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}">{defs()}{inner}</svg>'
    )


def pill(x, y, text, fill=AMBER, txt=NAVY, fs=24, pad=26):
    # 0.66em per bold char + ~1.6px letter-spacing per char + side padding
    w = len(text) * fs * 0.66 + len(text) * 1.6 + pad * 2
    return (
        f'<g><rect x="{x}" y="{y}" width="{w:.0f}" height="{fs+pad}" rx="{(fs+pad)/2}" '
        f'fill="{fill}"/>'
        f'<text x="{x+w/2:.0f}" y="{y+(fs+pad)/2+fs*0.34:.0f}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="{fs}" font-weight="bold" letter-spacing="1.5" '
        f'fill="{txt}">{esc(text)}</text></g>'
    )


def check_row(x, y, text, fs=33):
    return (
        f'<circle cx="{x+16}" cy="{y-8}" r="18" fill="{AMBER}"/>'
        f'<path d="M{x+8},{y-8} l6,7 l12,-15" fill="none" stroke="{NAVY}" '
        f'stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<text x="{x+52}" y="{y+2}" font-family="{FONT}" font-size="{fs}" '
        f'fill="{WHITE}">{esc(text)}</text>'
    )


# ----------------------------------------------------------------------------
# Ad 1 — Brand / hero
# ----------------------------------------------------------------------------
def ad_hero():
    traces = [
        "M0,300 H180 V200", "M180,200 H320", "M0,760 H140 V860",
        "M1080,420 H940 V520", "M1080,700 H880",
    ]
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'{circuit_bg(traces)}'
        # giant ghost bolt on right
        f'{bolt(835, 560, scale=5.4, fill=AMBER, opacity=0.10)}'
        f'{bolt(835, 560, scale=4.0, fill=AMBER, opacity=1.0)}'
        f'{logo_lockup(64, 70, scale=1.18)}'
        # est badge
        f'<g transform="translate(64,250)">'
        f'<rect x="0" y="0" width="250" height="46" rx="23" fill="none" '
        f'stroke="{AMBER}" stroke-width="2"/>'
        f'<text x="125" y="31" text-anchor="middle" font-family="{FONT}" '
        f'font-size="22" font-weight="bold" letter-spacing="2" fill="{AMBER}">'
        f'EST. 1986  •  40+ YEARS</text></g>'
        # headline
        f'<text x="64" y="430" font-family="{FONT}" font-size="78" font-weight="bold" '
        f'fill="{WHITE}">KEEPING</text>'
        f'<text x="64" y="512" font-family="{FONT}" font-size="78" font-weight="bold" '
        f'fill="{WHITE}">CENTRAL WEST</text>'
        f'<text x="64" y="594" font-family="{FONT}" font-size="78" font-weight="bold" '
        f'fill="{AMBER}">BUSINESSES</text>'
        f'<text x="64" y="676" font-family="{FONT}" font-size="78" font-weight="bold" '
        f'fill="{AMBER}">POWERED</text>'
        f'<text x="66" y="752" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'Industrial &#8226; Commercial &#8226; Compliance</text>'
        f'<text x="66" y="800" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'Locally owned in Dubbo &amp; Central West NSW</text>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# Ad 2 — Industrial 24/7 breakdown
# ----------------------------------------------------------------------------
def ad_industrial():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        # bold amber top band with diagonal base
        f'<path d="M0,0 L1080,0 L1080,300 L0,360 Z" fill="url(#amber)"/>'
        f'<path d="M0,360 L1080,300 L1080,312 L0,372 Z" fill="{NAVY_3}" opacity="0.25"/>'
        f'{bolt(910, 165, scale=2.1, fill=NAVY, opacity=0.14)}'
        f'{logo_lockup(64, 60, scale=1.0, on_dark=False)}'
        f'<text x="64" y="252" font-family="{FONT}" font-size="46" font-weight="bold" '
        f'fill="{NAVY}">INDUSTRIAL DOWNTIME?</text>'
        # huge 24/7 (now fully on navy)
        f'<text x="60" y="540" font-family="{FONT}" font-size="150" font-weight="bold" '
        f'fill="{AMBER}">24/7</text>'
        f'<text x="68" y="610" font-family="{FONT}" font-size="50" font-weight="bold" '
        f'fill="{WHITE}">BREAKDOWN SERVICE</text>'
        f'<text x="68" y="656" font-family="{FONT}" font-size="28" fill="{MIST}">'
        f'When your line stops, every minute counts. We answer.</text>'
        f'{check_row(72, 730, "Machinery wiring & fault finding", fs=30)}'
        f'{check_row(72, 790, "Automation & control systems", fs=30)}'
        f'{check_row(72, 850, "Installation & preventive maintenance", fs=30)}'
        f'{pill(72, 902, "CALL THE 24/7 LINE", fs=26)}'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# Ad 3 — Compliance / safety
# ----------------------------------------------------------------------------
def ad_compliance():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        # side panel
        f'<rect x="0" y="0" width="22" height="{SIZE}" fill="{AMBER}"/>'
        f'{bolt(880, 720, scale=4.6, fill=AMBER, opacity=0.08)}'
        f'{logo_lockup(64, 70, scale=1.0)}'
        f'{pill(64, 210, "COMPLIANCE & SAFETY", fs=24)}'
        f'<text x="64" y="358" font-family="{FONT}" font-size="74" font-weight="bold" '
        f'fill="{WHITE}">STAY SAFE.</text>'
        f'<text x="64" y="440" font-family="{FONT}" font-size="74" font-weight="bold" '
        f'fill="{AMBER}">STAY COMPLIANT.</text>'
        f'<text x="66" y="500" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'Audit-ready electrical compliance for your workplace.</text>'
        f'{check_row(72, 590, "RCD testing")}'
        f'{check_row(72, 654, "Test & Tag")}'
        f'{check_row(72, 718, "Emergency light inspections")}'
        f'{check_row(72, 782, "Switchboard audits")}'
        # ISO badges
        f'<g transform="translate(64,830)">'
        f'<rect x="0" y="0" width="210" height="48" rx="10" fill="none" stroke="{MIST}" stroke-width="2"/>'
        f'<text x="105" y="31" text-anchor="middle" font-family="{FONT}" font-size="20" '
        f'font-weight="bold" fill="{MIST}">ISO 9001:2018</text>'
        f'<rect x="226" y="0" width="210" height="48" rx="10" fill="none" stroke="{MIST}" stroke-width="2"/>'
        f'<text x="331" y="31" text-anchor="middle" font-family="{FONT}" font-size="20" '
        f'font-weight="bold" fill="{MIST}">ISO 45001:2018</text>'
        f'</g>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# Ad 4 — Free quote CTA
# ----------------------------------------------------------------------------
def ad_quote():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#amber)"/>'
        # navy panel bottom
        f'<path d="M0,640 L1080,550 L1080,1080 L0,1080 Z" fill="url(#navy)"/>'
        f'{bolt(190, 250, scale=2.2, fill=NAVY, opacity=0.13)}'
        f'{bolt(900, 800, scale=3.2, fill=AMBER, opacity=0.10)}'
        f'{logo_lockup(64, 64, scale=1.05, on_dark=False)}'
        f'<text x="64" y="296" font-family="{FONT}" font-size="40" font-weight="bold" '
        f'fill="{NAVY}">COMMERCIAL &amp; INDUSTRIAL ELECTRICAL</text>'
        f'<text x="60" y="478" font-family="{FONT}" font-size="172" font-weight="bold" '
        f'fill="{NAVY}">FREE</text>'
        f'<text x="60" y="570" font-family="{FONT}" font-size="86" font-weight="bold" '
        f'fill="{NAVY}">QUOTES</text>'
        # on navy
        f'<text x="64" y="700" font-family="{FONT}" font-size="34" fill="{MIST}">'
        f'Data &amp; fibre cabling &#8226; Security systems</text>'
        f'<text x="64" y="748" font-family="{FONT}" font-size="34" fill="{MIST}">'
        f'Installs, repairs &amp; facility maintenance</text>'
        f'<text x="64" y="844" font-family="{FONT}" font-size="30" font-weight="bold" '
        f'fill="{WHITE}">Call today &#8212; Dubbo &amp; Central West NSW</text>'
        f'<text x="60" y="918" font-family="{FONT}" font-size="64" font-weight="bold" '
        f'fill="{AMBER}">02 6884 9292</text>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
ADS = {
    "01_hero_powered":        ad_hero,
    "02_industrial_24-7":     ad_industrial,
    "03_compliance_safety":   ad_compliance,
    "04_free_quotes":         ad_quote,
}


def main():
    for name, fn in ADS.items():
        svg = fn()
        svg_path = os.path.join(OUT, name + ".svg")
        png_path = os.path.join(OUT, name + ".png")
        with open(svg_path, "w") as f:
            f.write(svg)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=png_path,
                         output_width=SIZE, output_height=SIZE)
        print("wrote", png_path)


if __name__ == "__main__":
    main()
