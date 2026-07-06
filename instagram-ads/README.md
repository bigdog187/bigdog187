# Weiley Electrical — Instagram Ad Campaign (v2 "Schematic")

Seven ready-to-post **1080×1080** ads for [@weileyelec](https://www.facebook.com/weileyelec),
built from **all** the content across [wyelec.com.au](https://wyelec.com.au)
(home, about, industrial, commercial, compliance and contact pages).

## Design language — v2 "Schematic"
Engineering blueprint / electrical schematic aesthetic, red / white / blue:
- deep ink-blue drafting grid with corner registration crosshairs
- circuit-bus service lists with glowing junction nodes and terminal pads
- ghost outline display type, faux-glow radial gradients, halftone fades
- monospace engineering annotations, dimension lines, square pulse waves
- rubber-stamp "AUDIT READY" inspection seal and a free-quote voucher ticket
- engineering title-block footer with per-ad sheet numbers (SHT 01/07 … 07/07)

| File | Concept | Use it for |
|------|---------|-----------|
| `01_hero_powered.png` | Brand / tagline — *"Keeping Central West Businesses Powered"* | Awareness, profile pinning |
| `02_industrial.png` | Industrial electrical capabilities | Plants, factories, operations managers |
| `03_commercial.png` | Commercial fit-outs, repairs & maintenance | Retail, offices, hospitality |
| `04_compliance.png` | Compliance & safety + AUDIT READY stamp | Facility / WHS managers, audit season |
| `05_industries_served.png` | Who we work with (industries) | Broad reach across the Central West |
| `06_why_choose_us.png` | Credentials & stat cards | Trust / consideration stage |
| `07_free_quote_contact.png` | Free-quote voucher + full contact details | Direct-response lead generation |

Each `.png` has a matching editable `.svg` source.

## Content pulled from the website
- **Tagline:** *Keeping Central West Businesses Powered*
- **Brand:** Established 1986 · 40+ years · locally owned & operated · Dubbo & Central West NSW
- **Industrial:** PLC/SCADA/HMI, control panel design & build, machinery wiring & automation,
  hazardous-area electrical, instrumentation & controls, pump control & diagnostics,
  telemetry & remote monitoring, fault finding, installs & upgrades, preventive maintenance,
  24/7 industrial breakdown service
- **Commercial:** switchboards & lighting, power & machinery wiring, data cabling (phone/POS/PC),
  fibre optic infrastructure, CCTV & security systems, facility maintenance, fault diagnostics,
  emergency fault response
- **Compliance:** RCD (safety switch) testing & install, Test & Tag, emergency light testing,
  switchboard thermal imaging, electrical auditing & compliance checks
- **Industries served:** retail stores, workshops, warehouses, offices, hospitality,
  agriculture, industrial plants, education
- **Credentials:** ISO 9001:2018 & ISO 45001:2018 · free quotes · quality assurance
- **Contact:** 02 6884 9292 · service@wyelec.com.au · Unit 9B, 55 Wheelers Lane, Dubbo NSW 2830 ·
  Mon–Fri 7:30am–4pm · 24/7 industrial breakdown

## Note on brand colours
The website didn't expose explicit brand hex values, so these use a red / white / blue
palette (per request). Share your exact brand colours and a logo file and I can swap
them in for a perfect match.

## Regenerate / edit
```bash
pip install cairosvg pillow
python3 generate_ads.py
```
Copy, colours (`RED`, `BLUE`, `INK`, …) and layout live near the top of `generate_ads.py`.
