# CBCharts Market Dashboard

Static GitHub Pages dashboard for CBCharts market data.

## Sources
- **pusherman3000**: historical ranked Call/Put 1–5 levels for timelapse.
- **Voltra**: strike-level volume, open interest, adjusted volume, and totals.
- **RatPack**: current GEX/CEX/DEX/VEX call, put, total, and ratio values.
- **BrentBSVisuals**: existing Plotly HTML views.

## Local test
From this folder in PowerShell:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages deployment
1. Create a public repo for this dashboard.
2. Push these files to `main`.
3. GitHub repo → **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Branch: `main`; folder: `/(root)`.
6. Save.

## Initial behavior
- RatPack, Voltra, and BrentBSVisuals refresh every 60 seconds.
- The top gauge strip stays visible and uses red/green sign coloring.
- `Full` maps to `All_tota.csv` in Voltra.
- Timelapse defaults to `2026-08-20` for the restored historical test data.
- Timelapse loads `timestamp`, `strikePrice`, `Theo ES`, `Rank`, `Greek`, and `Value` from pusherman3000.
- The ThinkScript view exports the latest Call/Put ranked levels from the selected historical date.

No backend, database, paid hosting, or server process is required.
