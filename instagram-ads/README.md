# Weiley Electrical — Instagram Ad Campaign

A full set of **seven** ready-to-post **1080×1080** square ads for
[@weileyelec](https://www.facebook.com/weileyelec), built from **all** the
content across [wyelec.com.au](https://wyelec.com.au) (home, about, industrial,
commercial, compliance and contact pages).

| File | Concept | Use it for |
|------|---------|-----------|
| `01_hero_powered.png` | Brand / tagline — *"Keeping Central West Businesses Powered"* | Awareness, profile pinning |
| `02_industrial.png` | Industrial electrical capabilities | Plants, factories, operations managers |
| `03_commercial.png` | Commercial fit-outs, repairs & maintenance | Retail, offices, hospitality |
| `04_compliance.png` | Compliance & safety services | Facility / WHS managers, audit season |
| `05_industries_served.png` | Who we work with (industries) | Broad reach across the Central West |
| `06_why_choose_us.png` | Why choose Weiley (credentials & stats) | Trust / consideration stage |
| `07_free_quote_contact.png` | Free quotes + full contact details | Direct-response lead generation |

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
The website didn't expose explicit brand hex values, so these use a professional
**navy + electric-amber** electrician palette with a lightning-bolt mark. Share your
exact brand colours and a logo file and I can swap them in for a perfect match.

## Regenerate / edit
```bash
pip install cairosvg pillow
python3 generate_ads.py
```
Edit copy, colours (`NAVY`, `AMBER`, …) or layout near the top of `generate_ads.py`.
