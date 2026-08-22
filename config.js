window.CB_CONFIG = {
  refreshMs: 60000,
  defaultBucket: "0dte",
  defaultGreek: "GEX",
  rawBase: "https://raw.githubusercontent.com/CBCharts",
  repos: {
    pusherman: {name:"pusherman3000",url:"https://github.com/CBCharts/pusherman3000",description:"Historical ranked Brent BS levels used for Call/Put 1–5 timelapse flow."},
    voltra: {name:"Voltra",url:"https://github.com/CBCharts/Voltra",description:"Strike-level volume, open interest, adjusted volume, totals, and rankings."},
    ratpack: {name:"RatPack",url:"https://github.com/CBCharts/RatPack",description:"Current GEX/CEX/DEX/VEX call, put, total, and ratio values."},
    visuals: {name:"BrentBSVisuals",url:"https://github.com/CBCharts/BrentBSVisuals",description:"Pre-rendered Plotly HTML views for each expiration bucket and Greek."}
  },
  buckets: {
    "0dte": {label:"0DTE",pusherman:"0dte_brent_bs_results_ranked_historical.csv",voltra:"0dte_tota.csv",ratpack:"0dte_brent_bs_greek_totals.json",visualPrefix:"0dte"},
    "1dte": {label:"1DTE",pusherman:"1dte_brent_bs_results_ranked_historical.csv",voltra:"1dte_tota.csv",ratpack:"1dte_brent_bs_greek_totals.json",visualPrefix:"1dte"},
    "EoW": {label:"EOW",pusherman:"EoW_brent_bs_results_ranked_historical.csv",voltra:"EoW_tota.csv",ratpack:"EoW_brent_bs_greek_totals.json",visualPrefix:"EoW"},
    "EoM": {label:"EOM",pusherman:"EoM_brent_bs_results_ranked_historical.csv",voltra:"EoM_tota.csv",ratpack:"EoM_brent_bs_greek_totals.json",visualPrefix:"EoM"},
    "nex_EoW": {label:"Next EOW",pusherman:"nex_EoW_brent_bs_results_ranked_historical.csv",voltra:"nex_EoW_tota.csv",ratpack:"nex_EoW_brent_bs_greek_totals.json",visualPrefix:"nex_EoW"},
    "nex_EoM": {label:"Next EOM",pusherman:"nex_EoM_brent_bs_results_ranked_historical.csv",voltra:"nex_EoM_tota.csv",ratpack:"nex_EoM_brent_bs_greek_totals.json",visualPrefix:"nex_EoM"},
    "Full": {label:"Full",pusherman:"Full_brent_bs_results_ranked_historical.csv",voltra:"All_tota.csv",ratpack:"Full_brent_bs_greek_totals.json",visualPrefix:"Full"}
  }
};