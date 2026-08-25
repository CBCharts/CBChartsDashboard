(() => {
  "use strict";

  const C = window.CB_CONFIG;
  const GREEKS = ["GEX", "CEX", "DEX", "VEX"];
  const $ = (id) => document.getElementById(id);

  const state = {
    view: "overview",
    bucket: C.defaultBucket,
    greek: C.defaultGreek,
    ratpack: null,
    voltra: [],
    history: null,
    playTimer: null,
    frame: 0,

    snapshotChartCount: 1,
    snapshotCharts: [
      {
        metric: "adjustedSum",
        lastSingleMetric: "adjustedSum",
        multiMetrics: ["adjustedSum"]
      },
      {
        metric: "oi",
        lastSingleMetric: "oi",
        multiMetrics: ["oi"]
      }
    ],

    visualChartCount: 2,
    visualBuckets: ["0dte", "1dte"],

    graphSize: "large",
    timelapseMode: "levels",
    playbackSpeed: 1,
    playbackPassesCompleted: 0,

    autoRefreshEnabled: false,
    refreshMinutes: 5,
    refreshTimer: null,
    refreshPromise: null,

    manualRefreshReadyAt: 0,
    manualRefreshTicker: null,
    manualRefreshBusy: false,
    hideManualRefreshNotice: false,

    historyDateNoticeTimer: null,

    lastDataOk: null,
    lastDataMessage: "Loading latest data",

    generatedScriptType: null,
    generatedScriptFolder: null,

    spxSpot: null,
    theoEsBasis: null,
    latestPushermanFolders: [],
    latestFolderLookupAt: 0
  };

  const plotConfig = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
  };

  const GRAPH_SIZES = {
    compact: 0.72,
    standard: 1,
    large: 1.35
  };

  function graphScale() {
    return GRAPH_SIZES[state.graphSize] || GRAPH_SIZES.large;
  }

  function setElementGraphHeight(id, baseHeight) {
    const element = $(id);
    if (!element) return;

    element.dataset.baseHeight = String(baseHeight);
    element.style.height = `${Math.round(baseHeight * graphScale())}px`;
  }

  function resizePlotlyElement(id) {
    const element = $(id);
    if (!element || !element.data) return;

    requestAnimationFrame(() => {
      try {
        Plotly.Plots.resize(element);
      } catch (_) {
        // Ignore resize calls before a plot has fully initialized.
      }
    });
  }

  const EMBEDDED_VISUAL_HEIGHTS = {
    compact: 340,
    standard: 410,
    large: 500
  };

  function resizeEmbeddedVisual(index = null) {
    const indexes = index == null ? [1, 2] : [index];

    indexes.forEach((slot) => {
      const frame = $(`visualFrame${slot}`);
      if (!frame) return;

      // BrentBSVisuals has a much shorter natural aspect ratio than the
      // Voltra/Timelapse charts. Use dedicated heights instead of scaling
      // the old 650px iframe, which created large empty areas below the plot.
      const height =
        EMBEDDED_VISUAL_HEIGHTS[state.graphSize] ||
        EMBEDDED_VISUAL_HEIGHTS.large;

      frame.style.minHeight = `${height}px`;
      frame.style.height = `${height}px`;

      const panel = frame.closest(".visual-panel");
      if (panel) {
        panel.style.minHeight = `${height + 58}px`;
      }

      const loading = $(`visualLoading${slot}`);
      if (loading) loading.style.minHeight = `${height}px`;

      try {
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;

        if (!frameWindow || !frameDocument) return;

        frameWindow.dispatchEvent(new Event("resize"));

        const plots = frameDocument.querySelectorAll(".plotly-graph-div");

        plots.forEach((plot) => {
          if (frameWindow.Plotly?.relayout) {
            frameWindow.Plotly.relayout(plot, {
              autosize: true,
              height
            });
          }

          if (frameWindow.Plotly?.Plots?.resize) {
            frameWindow.Plotly.Plots.resize(plot);
          }
        });
      } catch (_) {
        // srcdoc is normally same-origin; if a browser blocks access,
        // the iframe container itself still resizes.
      }
    });
  }

  function applyGraphSize(value, persist = true) {
    state.graphSize = Object.hasOwn(GRAPH_SIZES, value)
      ? value
      : "large";

    const select = $("graphSizeSelect");
    if (select) select.value = state.graphSize;

    if (persist) {
      try {
        localStorage.setItem("cbcharts-graph-size-v1.5.1", state.graphSize);
      } catch (_) {}
    }

    [1, 2].forEach((index) => {
      const voltra = $(`voltraChart${index}`);

      if (voltra) {
        const base = Number(voltra.dataset.baseHeight) || 650;
        voltra.style.height = `${Math.round(base * graphScale())}px`;
      }

      resizePlotlyElement(`voltraChart${index}`);
    });

    setElementGraphHeight("timelapseChart", 560);
    resizeEmbeddedVisual();
    resizePlotlyElement("timelapseChart");

    ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
      resizePlotlyElement(`gauge-${metric}`);
    });
  }

  function loadStoredGraphSize() {
    // v1.5.1 intentionally uses a fresh storage key so Large becomes the
    // default even for browsers that previously saved Compact or Standard.
    try {
      const stored = localStorage.getItem("cbcharts-graph-size-v1.5.1");

      if (stored && Object.hasOwn(GRAPH_SIZES, stored)) {
        state.graphSize = stored;
      }
    } catch (_) {}
  }

  function makeEmbeddedPlotlyResponsive(html) {
    const responsiveCss = `
      <style id="cbcharts-responsive-plotly">
        html, body {
          width: 100% !important;
          height: 100% !important;
          min-height: 100% !important;
          margin: 0 !important;
          overflow: hidden !important;
          background: #0a0f16 !important;
        }

        .plotly-graph-div,
        .js-plotly-plot,
        .plot-container,
        .svg-container {
          width: 100% !important;
          max-width: 100% !important;
          height: 100% !important;
          min-height: 100% !important;
        }
      </style>
    `;

    const responsiveScript = `
      <script id="cbcharts-responsive-plotly-script">
        (() => {
          const resizePlots = () => {
            try {
              document.querySelectorAll(".plotly-graph-div").forEach((plot) => {
                if (window.Plotly?.Plots?.resize) {
                  window.Plotly.Plots.resize(plot);
                }
              });
            } catch (_) {}
          };

          window.addEventListener("load", () => setTimeout(resizePlots, 30));
          window.addEventListener("resize", resizePlots);

          if ("ResizeObserver" in window) {
            const observer = new ResizeObserver(() => resizePlots());
            observer.observe(document.documentElement);
          }
        })();
      </script>
    `;

    let output = html;

    if (/<\/head>/i.test(output)) {
      output = output.replace(/<\/head>/i, `${responsiveCss}</head>`);
    } else {
      output = `${responsiveCss}${output}`;
    }

    if (/<\/body>/i.test(output)) {
      output = output.replace(/<\/body>/i, `${responsiveScript}</body>`);
    } else {
      output += responsiveScript;
    }

    return output;
  }

  const baseLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#b8c7d8",
      family: "Inter, system-ui, sans-serif",
      size: 11
    },
    margin: { l: 56, r: 24, t: 24, b: 48 },
    xaxis: {
      gridcolor: "rgba(255,255,255,.06)",
      zerolinecolor: "rgba(255,255,255,.20)"
    },
    yaxis: {
      gridcolor: "rgba(255,255,255,.045)",
      zerolinecolor: "rgba(255,255,255,.15)"
    }
  };

  // v0.2 number rule:
  // - never abbreviate to K/M/B
  // - preserve integers and existing decimals
  // - round only beyond thousandths (3 decimals)
  const numberFormatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : "—";
  }

  function formatCodeNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return String(Math.round((number + Number.EPSILON) * 1000) / 1000);
  }

  function raw(repo, path, bust = true) {
    const url = `${C.rawBase}/${repo}/main/${path}`;
    return bust ? `${url}?cb=${Date.now()}` : url;
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }


  async function fetchTailText(url, bytes = 65536) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Range: `bytes=-${bytes}`
        }
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (_) {
      // Fallback for browsers/CDNs that do not permit a Range request.
      return fetchText(url);
    }
  }

  function extractSpxSpotFromPlotlyHtml(html) {
    if (!html) return null;

    // Preferred: find a yellow dashed horizontal Plotly shape.
    // The BrentBSVisuals files use that shape for SPX spot.
    const shapePattern =
      /"line"\s*:\s*\{[\s\S]{0,250}?"color"\s*:\s*"yellow"[\s\S]{0,250}?"dash"\s*:\s*"dash"[\s\S]{0,700}?"y0"\s*:\s*(-?\d+(?:\.\d+)?)[\s\S]{0,220}?"y1"\s*:\s*(-?\d+(?:\.\d+)?)/gi;

    let match;

    while ((match = shapePattern.exec(html)) !== null) {
      const y0 = Number(match[1]);
      const y1 = Number(match[2]);

      if (
        Number.isFinite(y0) &&
        Number.isFinite(y1) &&
        Math.abs(y0 - y1) < 1e-9
      ) {
        return y0;
      }
    }

    // Alternate ordering used by some Plotly serializations.
    const alternatePattern =
      /"y0"\s*:\s*(-?\d+(?:\.\d+)?)[\s\S]{0,220}?"y1"\s*:\s*(-?\d+(?:\.\d+)?)[\s\S]{0,700}?"color"\s*:\s*"yellow"[\s\S]{0,250}?"dash"\s*:\s*"dash"/gi;

    while ((match = alternatePattern.exec(html)) !== null) {
      const y0 = Number(match[1]);
      const y1 = Number(match[2]);

      if (
        Number.isFinite(y0) &&
        Number.isFinite(y1) &&
        Math.abs(y0 - y1) < 1e-9
      ) {
        return y0;
      }
    }

    // Final fallback if the HTML includes the spot value in a text annotation.
    const labeledPatterns = [
      /SPX Spot Price[^0-9-]*(-?\d+(?:\.\d+)?)/i,
      /SPX Spot[^0-9-]*(-?\d+(?:\.\d+)?)/i
    ];

    for (const pattern of labeledPatterns) {
      const labeled = html.match(pattern);
      const value = Number(labeled?.[1]);

      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  function currentTheoEsSpot() {
    const spx = Number(state.spxSpot);
    const basis = Number(state.theoEsBasis?.difference);

    return Number.isFinite(spx) && Number.isFinite(basis)
      ? spx + basis
      : null;
  }

  function renderSpotPrices() {
    const spx = Number(state.spxSpot);
    const basis = Number(state.theoEsBasis?.difference);

    const spxValue = $("spxSpotValue");
    const spxMeta = $("spxSpotMeta");
    const theoValue = $("theoEsSpotValue");
    const theoMeta = $("theoEsSpotMeta");

    if (Number.isFinite(spx)) {
      spxValue.textContent = formatNumber(spx);

      // v0.6.1: keep the SPX card minimal — label + value only.
      spxMeta.textContent = "";
      spxMeta.classList.add("hidden");

      $("spxSpotCard").classList.remove("unavailable");
    } else {
      spxValue.textContent = "—";
      spxMeta.textContent = "";
      spxMeta.classList.add("hidden");

      $("spxSpotCard").classList.add("unavailable");
    }

    const theoSpot = currentTheoEsSpot();

    if (Number.isFinite(theoSpot)) {
      theoValue.textContent = formatNumber(theoSpot);

      // Keep the YYYYMMDD folder date and append only the time from the
      // last pusherman row, e.g. "20260820 · 12:58:27".
      const rawTimestamp = String(state.theoEsBasis.timestamp || "").trim();
      const timeMatch = rawTimestamp.match(/(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
      const timeText = timeMatch ? timeMatch[1] : "";

      theoMeta.textContent = timeText
        ? `${state.theoEsBasis.folder} · ${timeText}`
        : state.theoEsBasis.folder;

      theoMeta.classList.remove("hidden");

      $("theoEsSpotCard").classList.remove("unavailable");
      $("theoEsSpotCard").removeAttribute("title");
    } else {
      theoValue.textContent = "—";
      theoMeta.textContent = state.theoEsBasis?.folder || "";
      theoMeta.classList.toggle("hidden", !theoMeta.textContent);

      $("theoEsSpotCard").classList.add("unavailable");
      $("theoEsSpotCard").removeAttribute("title");
    }
  }

  async function getLatestPushermanFolders(force = false) {
    const now = Date.now();
    const cacheAge = now - state.latestFolderLookupAt;

    // Folder discovery only needs occasional refresh. The CSV itself still
    // refreshes each minute.
    if (
      !force &&
      state.latestPushermanFolders.length &&
      cacheAge < 15 * 60 * 1000
    ) {
      return state.latestPushermanFolders;
    }

    const url =
      `https://api.github.com/repos/CBCharts/pusherman3000/contents` +
      `?ref=main&cb=${Date.now()}`;

    const entries = await fetchJSON(url);

    const folders = entries
      .filter((entry) =>
        entry?.type === "dir" &&
        /^\d{8}$/.test(String(entry.name))
      )
      .map((entry) => String(entry.name))
      .sort((a, b) => b.localeCompare(a));

    if (!folders.length) {
      throw new Error("No YYYYMMDD folders found in pusherman3000.");
    }

    state.latestPushermanFolders = folders;
    state.latestFolderLookupAt = now;

    return folders;
  }

  function extractLastPushermanRow(csvTail) {
    const lines = String(csvTail || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Walk backward so a partial first line from a Range response does not matter.
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];

      if (/^timestamp\s*,/i.test(line)) continue;

      const parsed = Papa.parse(line, {
        header: false,
        dynamicTyping: true,
        skipEmptyLines: true
      });

      const row = parsed.data?.[0];

      if (!Array.isArray(row) || row.length < 3) continue;

      const strikePrice = Number(row[1]);
      const theoES = Number(row[2]);

      if (
        !Number.isFinite(strikePrice) ||
        !Number.isFinite(theoES)
      ) {
        continue;
      }

      return {
        timestamp: row[0] != null ? String(row[0]) : "",
        strikePrice,
        theoES
      };
    }

    return null;
  }

  async function loadTheoEsBasis() {
    try {
      const folders = await getLatestPushermanFolders();
      const fileName = C.buckets[state.bucket].pusherman;

      let lastError = null;

      // Normally the first folder is all we need. Trying a few recent folders
      // also handles the brief period when a new trading-date folder exists
      // before every expiration bucket has been written.
      for (const folder of folders.slice(0, 5)) {
        const path = `${folder}/brent_bs/${fileName}`;
        const url = raw("pusherman3000", path);

        try {
          const tail = await fetchTailText(url);
          const row = extractLastPushermanRow(tail);

          if (!row) {
            throw new Error("No valid final row.");
          }

          state.theoEsBasis = {
            ...row,
            folder,
            difference: row.theoES - row.strikePrice
          };

          renderSpotPrices();

          if (state.voltra.length) {
            renderAllVoltra();
          }

          return;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("No recent bucket CSV could be read.");
    } catch (error) {
      state.theoEsBasis = null;
      renderSpotPrices();

      if (state.voltra.length) {
        renderAllVoltra();
      }

      console.warn("Theo ES spot basis unavailable:", error);
    }
  }

  function parseCSV(text) {
    const parsed = Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true
    });
    return parsed.data;
  }

  function showError(id, message) {
    $(id).textContent = message;
    $(id).classList.remove("hidden");
  }

  function clearError(id) {
    $(id).textContent = "";
    $(id).classList.add("hidden");
  }

  function formatRefreshFrequency(minutes) {
    return `${minutes} min`;
  }

  const MANUAL_REFRESH_COOLDOWN_MS = 3 * 60 * 1000;

  function manualRefreshRemainingMs() {
    return Math.max(0, state.manualRefreshReadyAt - Date.now());
  }

  function formatCooldown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function updateManualRefreshUI() {
    const button = $("manualRefreshButton");
    if (!button) return;

    const remaining = manualRefreshRemainingMs();
    const frozen = remaining > 0 || state.manualRefreshBusy;

    button.disabled = frozen;
    button.classList.toggle("cooldown", frozen);
    button.classList.toggle("ready", !frozen);

    if (state.manualRefreshBusy) {
      $("manualRefreshText").textContent = "Refreshing…";
      button.title = "Refreshing dashboard data";
    } else if (remaining > 0) {
      $("manualRefreshText").textContent = formatCooldown(remaining);
      button.title =
        `Manual refresh available again in ${formatCooldown(remaining)}`;
    } else {
      $("manualRefreshText").textContent = "Refresh";
      button.title = "Manually refresh dashboard data";
    }
  }

  function stopManualRefreshTicker() {
    if (state.manualRefreshTicker) {
      clearInterval(state.manualRefreshTicker);
      state.manualRefreshTicker = null;
    }
  }

  function startManualRefreshTicker() {
    stopManualRefreshTicker();
    updateManualRefreshUI();

    if (manualRefreshRemainingMs() <= 0) return;

    state.manualRefreshTicker = setInterval(() => {
      updateManualRefreshUI();

      if (manualRefreshRemainingMs() <= 0) {
        stopManualRefreshTicker();
        updateManualRefreshUI();
      }
    }, 1000);
  }

  function setManualRefreshCooldown() {
    state.manualRefreshReadyAt = Date.now() + MANUAL_REFRESH_COOLDOWN_MS;

    try {
      localStorage.setItem(
        "cbcharts-manual-refresh-ready-at",
        String(state.manualRefreshReadyAt)
      );
    } catch (_) {}

    startManualRefreshTicker();
  }

  function showManualRefreshNotice() {
    if (state.hideManualRefreshNotice) return;

    $("manualRefreshDontShow").checked = false;
    $("manualRefreshModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeManualRefreshNotice() {
    if ($("manualRefreshDontShow").checked) {
      state.hideManualRefreshNotice = true;

      try {
        localStorage.setItem(
          "cbcharts-hide-manual-refresh-notice",
          "true"
        );
      } catch (_) {}
    }

    $("manualRefreshModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  async function runManualRefresh() {
    if (
      state.manualRefreshBusy ||
      manualRefreshRemainingMs() > 0
    ) {
      updateManualRefreshUI();
      return;
    }

    // Start the cooldown immediately so repeated clicks/network delays
    // cannot result in overlapping GitHub request bursts.
    state.manualRefreshBusy = true;
    setManualRefreshCooldown();
    updateManualRefreshUI();

    try {
      await refreshLive();

      if (state.view === "timelapse") {
        await loadHistory();
      }
    } finally {
      state.manualRefreshBusy = false;
      updateManualRefreshUI();
      showManualRefreshNotice();
    }
  }

  function initManualRefreshControl() {
    try {
      const storedReadyAt = Number(
        localStorage.getItem("cbcharts-manual-refresh-ready-at")
      );

      if (Number.isFinite(storedReadyAt)) {
        state.manualRefreshReadyAt = storedReadyAt;
      }

      state.hideManualRefreshNotice =
        localStorage.getItem("cbcharts-hide-manual-refresh-notice") ===
        "true";
    } catch (_) {}

    if (manualRefreshRemainingMs() <= 0) {
      state.manualRefreshReadyAt = 0;

      try {
        localStorage.removeItem("cbcharts-manual-refresh-ready-at");
      } catch (_) {}
    }

    startManualRefreshTicker();
  }

  function updateLivePowerUI() {
    const button = $("livePowerButton");
    const text = $("livePowerText");
    const menuStatus = $("liveMenuStatus");

    if (!button || !text || !menuStatus) return;

    button.classList.toggle("powered", state.autoRefreshEnabled);

    if (state.autoRefreshEnabled) {
      text.textContent =
        state.lastDataOk === false
          ? `Live · source issue`
          : `Live · ${formatRefreshFrequency(state.refreshMinutes)}`;

      menuStatus.textContent =
        `On · every ${state.refreshMinutes} minutes`;
      menuStatus.className = "live-status-on";
    } else {
      text.textContent =
        state.lastDataOk === false
          ? "Auto refresh off · source issue"
          : "Auto refresh off";

      menuStatus.textContent = "Off";
      menuStatus.className = "live-status-off";
    }
  }

  function setConnection(ok, text) {
    state.lastDataOk = ok;
    state.lastDataMessage = text || "";

    $("lastRefresh").textContent =
      `Last refresh ${new Date().toLocaleTimeString()}`;

    updateLivePowerUI();
  }

  function scheduleAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    if (!state.autoRefreshEnabled) return;

    state.refreshTimer = setInterval(async () => {
      await refreshLive();

      if (state.view === "timelapse") {
        await loadHistory();
      }
    }, state.refreshMinutes * 60 * 1000);
  }

  function setAutoRefreshEnabled(enabled) {
    state.autoRefreshEnabled = Boolean(enabled);
    scheduleAutoRefresh();
    updateLivePowerUI();
  }

  function toggleLivePowerMenu(forceOpen = null) {
    const menu = $("livePowerMenu");
    const button = $("livePowerButton");

    if (!menu || !button) return;

    const shouldOpen =
      forceOpen == null
        ? menu.classList.contains("hidden")
        : Boolean(forceOpen);

    menu.classList.toggle("hidden", !shouldOpen);
    button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }

  function initLivePowerControl() {
    try {
      const stored = Number(localStorage.getItem("cbcharts-refresh-minutes"));

      if ([3, 5, 15, 30, 60].includes(stored)) {
        state.refreshMinutes = stored;
      }
    } catch (_) {}

    $("refreshFrequencySelect").value = String(state.refreshMinutes);

    // Requirement: every page load starts with automatic refresh OFF.
    state.autoRefreshEnabled = false;
    updateLivePowerUI();
  }

  function initControls() {
    for (const [key, bucket] of Object.entries(C.buckets)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = bucket.label;
      $("bucketSelect").appendChild(option);
    }

    $("bucketSelect").value = state.bucket;
    $("greekSelect").value = state.greek;
  }

  // ---------------------------------------------------------------------------
  // LIVE MARKET OVERVIEW — selected Greek, four metric gauges
  // Order: Ratio, Total, Calls, Puts
  // ---------------------------------------------------------------------------

  function buildGaugeCards() {
    const metrics = [
      { key: "Ratio", label: "RATIO" },
      { key: "Total", label: "TOTAL" },
      { key: "Call", label: "CALLS" },
      { key: "Put", label: "PUTS" }
    ];

    $("gaugeGrid").innerHTML = metrics.map((metric) => `
      <article class="gauge-card" data-metric="${metric.key}">
        <div class="gauge-card-header">
          <div class="gauge-heading-group">
            <div class="gauge-metric-title">${metric.label}</div>
            <div class="gauge-context" id="gauge-greek-${metric.key}">
              ${state.greek} · ${C.buckets[state.bucket].label}
            </div>
          </div>
          <div class="gauge-sign" id="gauge-sign-${metric.key}">NO DATA</div>
        </div>

        <div class="gauge-value-row">
          <div class="gauge-value" id="gauge-value-${metric.key}">—</div>
          <div class="gauge-value-label">${metric.label}</div>
        </div>

        <div id="gauge-${metric.key}" class="gauge-chart" aria-label="${metric.label} gauge"></div>
      </article>
    `).join("");
  }

  function metricValue(data, metric) {
    return Number(data?.[`${state.greek}_${metric}`]);
  }

  function gaugeBound(metric, value, data) {
    if (metric === "Ratio") {
      // Keep 1.0 visibly meaningful on the scale.
      return Math.max(2, Math.abs(value) * 1.15);
    }

    const related = ["Total", "Call", "Put"]
      .map((name) => Math.abs(metricValue(data, name)))
      .filter(Number.isFinite);

    const maxMagnitude = related.length ? Math.max(...related) : Math.abs(value);
    return Math.max(1, maxMagnitude * 1.08);
  }

  function metricVisualState(metric, value, hasValue) {
    if (!hasValue) {
      return {
        tone: "neutral",
        status: metric === "Call" || metric === "Put" ? "" : "NO DATA",
        color: "#718397",
        background: "rgba(113,131,151,.08)"
      };
    }

    if (metric === "Ratio") {
      if (value < 1) {
        return {
          tone: "negative",
          status: "PUT HEAVY",
          color: "#ff5f68",
          background: "rgba(255,95,104,.08)"
        };
      }

      if (value > 1) {
        return {
          tone: "positive",
          status: "CALL HEAVY",
          color: "#31d17c",
          background: "rgba(49,209,124,.08)"
        };
      }

      return {
        tone: "balanced",
        status: "BALANCED",
        color: "#f4b942",
        background: "rgba(244,185,66,.08)"
      };
    }

    const positive = value >= 0;
    return {
      tone: positive ? "positive" : "negative",
      // Total keeps the sign label. Calls/Puts intentionally have no status badge.
      status: metric === "Total" ? (positive ? "POSITIVE" : "NEGATIVE") : "",
      color: positive ? "#31d17c" : "#ff5f68",
      background: positive
        ? "rgba(49,209,124,.08)"
        : "rgba(255,95,104,.08)"
    };
  }

  function renderMetricGauge(metric, data) {
    const value = metricValue(data, metric);
    const hasValue = Number.isFinite(value);
    const safeValue = hasValue ? value : 0;
    const visual = metricVisualState(metric, safeValue, hasValue);

    const gaugeValue = metric === "Ratio"
      ? Math.max(0, safeValue)
      : Math.abs(safeValue);

    const bound = gaugeBound(metric, safeValue, data);
    const signEl = $(`gauge-sign-${metric}`);
    const valueEl = $(`gauge-value-${metric}`);

    $(`gauge-greek-${metric}`).textContent =
      `${state.greek} · ${C.buckets[state.bucket].label}`;

    valueEl.textContent = formatNumber(value);
    valueEl.classList.remove("positive", "negative", "balanced");
    if (hasValue && visual.tone !== "neutral") {
      valueEl.classList.add(visual.tone);
    }

    signEl.textContent = visual.status;
    signEl.className = "gauge-sign";
    if (visual.status) {
      signEl.classList.add(visual.tone);
    } else {
      signEl.classList.add("empty");
    }

    const gauge = {
      shape: "angular",
      axis: {
        range: [0, bound],
        visible: true,
        tickmode: "array",
        tickvals: metric === "Ratio"
          ? [0, 1, bound]
          : [0, bound],
        ticktext: metric === "Ratio"
          ? ["0", "1.0", formatNumber(bound)]
          : ["0", formatNumber(bound)],
        tickfont: {
          size: 9,
          color: "#7f91a5"
        }
      },
      bgcolor: "rgba(255,255,255,.018)",
      borderwidth: 0,
      bar: {
        color: visual.color,
        thickness: 0.34
      }
    };

    if (metric === "Ratio") {
      gauge.steps = [
        {
          range: [0, Math.min(1, bound)],
          color: "rgba(255,95,104,.07)"
        },
        ...(bound > 1 ? [{
          range: [1, bound],
          color: "rgba(49,209,124,.07)"
        }] : [])
      ];
      gauge.threshold = {
        line: { color: "#f4b942", width: 2 },
        thickness: 0.8,
        value: 1
      };
    } else {
      gauge.steps = [{ range: [0, bound], color: visual.background }];
    }

    Plotly.react(
      `gauge-${metric}`,
      [{
        type: "indicator",
        mode: "gauge",
        value: gaugeValue,
        gauge
      }],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        margin: {
          l: 22,
          r: 22,
          t: 10,
          b: 2
        },
        height: 150
      },
      { ...plotConfig, displayModeBar: false }
    );
  }
  async function loadGauges() {
    clearError("overviewError");

    try {
      const data = await fetchJSON(raw("RatPack", C.buckets[state.bucket].ratpack));
      state.ratpack = data;

      ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
        renderMetricGauge(metric, data);
      });

      setConnection(true, "Live data connected");
    } catch (error) {
      setConnection(false, "RatPack unavailable");
      showError("overviewError", `Could not load RatPack: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // VOLTRA SNAPSHOT — ONLY *_tota.csv files configured in config.js
  // ---------------------------------------------------------------------------

  const VOLTRA_METRICS = {
    volume: {
      title: "Call / put volume by strike",
      shortLabel: "Volume",
      call: "call_vol_sum",
      put: "put_vol_sum",
      callLabel: "Call volume",
      putLabel: "Put volume"
    },
    oi: {
      title: "Call / put open interest by strike",
      shortLabel: "Open interest",
      call: "call_oi_sum",
      put: "put_oi_sum",
      callLabel: "Call OI",
      putLabel: "Put OI"
    },
    adjusted: {
      title: "Adjusted call / put volume by strike",
      shortLabel: "Adjusted volume",
      call: "adj_call_vol",
      put: "adj_put_vol",
      callLabel: "Adjusted call volume",
      putLabel: "Adjusted put volume"
    },
    totalVolume: {
      title: "Total volume by strike",
      shortLabel: "Total volume",
      single: "total_vol_sum",
      singleLabel: "Total volume"
    },
    adjustedSum: {
      title: "Adjusted sum by strike",
      shortLabel: "Adjusted sum",
      single: "adj_sum",
      singleLabel: "Adjusted sum"
    }
  };

  // Color pairs by plot slot:
  // 1) blue/red
  // 2) green/purple
  // 3) yellow/purple
  const VOLTRA_COLOR_PAIRS = [
    { call: "#49a5ff", put: "#ff6670" },
    { call: "#42d392", put: "#a678ff" },
    { call: "#f6c84c", put: "#d16dff" }
  ];

  function metricSpec(metricKey) {
    return VOLTRA_METRICS[metricKey];
  }

  function snapshotChartState(index) {
    return state.snapshotCharts[index - 1];
  }

  function selectedVoltraMetrics(index) {
    const mode = $(`snapshotMetric${index}`).value;

    if (mode !== "multi") {
      return [mode];
    }

    return [...document.querySelectorAll(
      `#multiMetricOptions${index} input[type="checkbox"]:checked`
    )]
      .map((input) => input.value)
      .slice(0, 3);
  }

  function updateMultiMetricUI(index, message = "") {
    const select = $(`snapshotMetric${index}`);
    const panel = $(`multiMetricPanel${index}`);
    const count = $(`multiMetricCount${index}`);

    if (!select || !panel || !count) return;

    const isMulti = select.value === "multi";
    panel.classList.toggle("hidden", !isMulti);

    if (!isMulti) return;

    const selected = selectedVoltraMetrics(index);
    count.textContent = message || `${selected.length}/3 selected`;

    document.querySelectorAll(
      `#multiMetricOptions${index} input[type="checkbox"]`
    ).forEach((input) => {
      input.disabled = !input.checked && selected.length >= 3;

      input.closest(".multi-metric-option")?.classList.toggle(
        "disabled",
        input.disabled
      );
    });
  }

  function initializeMultiMetricOptions(index) {
    const chartState = snapshotChartState(index);
    const container = $(`multiMetricOptions${index}`);

    const options = Object.entries(VOLTRA_METRICS)
      .map(([key, spec]) => `
        <label class="multi-metric-option">
          <input type="checkbox" value="${key}">
          <span>${spec.shortLabel}</span>
        </label>
      `)
      .join("");

    container.innerHTML = options;

    container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = chartState.multiMetrics.includes(input.value);

      input.addEventListener("change", () => {
        let selected = selectedVoltraMetrics(index);

        if (!selected.length) {
          input.checked = true;
          selected = [input.value];
          updateMultiMetricUI(index, "At least 1 metric is required");
          return;
        }

        if (selected.length > 3) {
          input.checked = false;
          updateMultiMetricUI(index, "Maximum 3 metrics");
          return;
        }

        chartState.multiMetrics = selected;
        updateMultiMetricUI(index);
        renderVoltra(index);
      });
    });

    updateMultiMetricUI(index);
  }

  function updateSnapshotChartVisibility() {
    const grid = $("strikeSnapshotGrid");
    const singleChart = state.snapshotChartCount === 1;

    if (grid) {
      grid.classList.toggle("single-strike-chart", singleChart);
      grid.classList.toggle("double-strike-chart", !singleChart);
    }

    [1, 2].forEach((index) => {
      const visible = index <= state.snapshotChartCount;
      $(`voltraPanel${index}`).classList.toggle("hidden", !visible);

      if (visible && state.voltra.length) {
        renderVoltra(index);
      }
    });

    // Plotly needs a resize after its parent grid changes width.
    requestAnimationFrame(() => {
      for (let index = 1; index <= state.snapshotChartCount; index++) {
        resizePlotlyElement(`voltraChart${index}`);
      }
    });
  }

  function renderVoltra(index = 1) {
    const chartId = `voltraChart${index}`;
    const errorId = `voltraError${index}`;
    const titleId = `voltraTitle${index}`;

    const sourceRows = state.voltra.filter((row) =>
      row.timestamp &&
      Number.isFinite(Number(row.strikePrice))
    );

    if (!sourceRows.length) {
      Plotly.purge(chartId);
      showError(
        errorId,
        "The selected Voltra file does not contain usable strike data."
      );
      return;
    }

    clearError(errorId);

    const selectedKeys = selectedVoltraMetrics(index);

    const specs = selectedKeys
      .map((key) => ({ key, ...metricSpec(key) }))
      .filter((spec) => spec.title);

    if (!specs.length) {
      Plotly.purge(chartId);
      showError(errorId, "Select at least one bar metric.");
      return;
    }

    $(titleId).textContent =
      specs.length === 1
        ? specs[0].title
        : specs.map((spec) => spec.shortLabel).join(" + ") + " by strike";

    const latestTimestamp = sourceRows
      .map((row) => String(row.timestamp))
      .sort()
      .at(-1);

    const latestRows = sourceRows.filter(
      (row) => String(row.timestamp) === latestTimestamp
    );

    const metricHasData = (row, spec) => {
      if (spec.single) {
        const value = Number(row[spec.single]);
        return Number.isFinite(value) && value !== 0;
      }

      const callValue = Number(row[spec.call]);
      const putValue = Number(row[spec.put]);

      return (
        (Number.isFinite(callValue) && callValue !== 0) ||
        (Number.isFinite(putValue) && putValue !== 0)
      );
    };

    const activeRows = latestRows
      .filter((row) => specs.some((spec) => metricHasData(row, spec)))
      .sort((a, b) => Number(a.strikePrice) - Number(b.strikePrice));

    if (!activeRows.length) {
      Plotly.purge(chartId);
      showError(
        errorId,
        `No non-zero data is available for the selected metric(s) in ` +
        `${C.buckets[state.bucket].label} at ${latestTimestamp}.`
      );
      return;
    }

    const strikes = activeRows.map((row) => Number(row.strikePrice));
    const theoValues = activeRows
      .map((row) => Number(row["Theo ES"]))
      .filter(Number.isFinite);

    const hoverData = activeRows.map((row) => {
      const adjustedCall = Number(row.adj_call_vol);
      const adjustedPut = Number(row.adj_put_vol);

      const adjustedVolume =
        (Number.isFinite(adjustedCall) ? adjustedCall : 0) +
        (Number.isFinite(adjustedPut) ? adjustedPut : 0);

      return [
        formatNumber(row.strikePrice),
        formatNumber(row["Theo ES"]),
        formatNumber(row.call_vol_sum),
        formatNumber(row.put_vol_sum),
        formatNumber(adjustedVolume),
        formatNumber(row.total_vol_sum),
        formatNumber(row.adj_sum)
      ];
    });

    const fullHoverTemplate =
      "<b>Strike:</b> %{customdata[0]}" +
      "<br><b>Theo ES:</b> %{customdata[1]}" +
      "<br><b>Call Volume:</b> %{customdata[2]}" +
      "<br><b>Put Volume:</b> %{customdata[3]}" +
      "<br><b>Adjusted Volume:</b> %{customdata[4]}" +
      "<br><b>Total Volume:</b> %{customdata[5]}" +
      "<br><b>Adjusted Sum:</b> %{customdata[6]}" +
      "<extra></extra>";

    const strikeDiffs = strikes
      .slice(1)
      .map((strike, rowIndex) => strike - strikes[rowIndex])
      .filter((diff) => Number.isFinite(diff) && diff > 0)
      .sort((a, b) => a - b);

    const medianStrikeStep = strikeDiffs.length
      ? strikeDiffs[Math.floor(strikeDiffs.length / 2)]
      : 25;

    const traces = [];
    const metricCount = specs.length;

    specs.forEach((spec, metricIndex) => {
      const colors = VOLTRA_COLOR_PAIRS[metricIndex];

      const widthFactor =
        metricCount === 1 ? 0.72 :
        metricCount === 2 ? 0.34 :
        0.22;

      const barWidth = Math.max(
        0.5,
        Math.min(25, medianStrikeStep * widthFactor)
      );

      if (spec.single) {
        const values = activeRows.map((row) => Number(row[spec.single]) || 0);

        traces.push({
          type: "bar",
          orientation: "h",
          name: spec.singleLabel,
          legendgroup: spec.key,
          offsetgroup: spec.key,
          y: strikes,
          x: values,
          width: barWidth,
          customdata: hoverData,
          marker: { color: colors.call },
          hovertemplate: fullHoverTemplate
        });

        return;
      }

      const callValues = activeRows.map(
        (row) => Number(row[spec.call]) || 0
      );

      const putValues = activeRows.map(
        (row) => Number(row[spec.put]) || 0
      );

      traces.push({
        type: "bar",
        orientation: "h",
        name: spec.callLabel,
        legendgroup: spec.key,
        offsetgroup: `${spec.key}-call`,
        y: strikes,
        x: callValues,
        width: barWidth,
        customdata: hoverData,
        marker: { color: colors.call },
        hovertemplate: fullHoverTemplate
      });

      traces.push({
        type: "bar",
        orientation: "h",
        name: spec.putLabel,
        legendgroup: spec.key,
        offsetgroup: `${spec.key}-put`,
        y: strikes,
        x: putValues.map((value) => -Math.abs(value)),
        width: barWidth,
        customdata: hoverData,
        marker: { color: colors.put },
        hovertemplate: fullHoverTemplate
      });
    });

    if (theoValues.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: "Theo ES axis",
        x: theoValues.map(() => 0),
        y: theoValues,
        yaxis: "y2",
        showlegend: false,
        hoverinfo: "skip",
        marker: {
          size: 1,
          opacity: 0
        }
      });
    }

    const minStrike = Math.min(...strikes);
    const maxStrike = Math.max(...strikes);
    const strikeSpan = Math.max(maxStrike - minStrike, medianStrikeStep);

    const strikePadding = Math.max(
      medianStrikeStep * 0.7,
      strikeSpan * 0.045
    );

    const strikeRange = [
      minStrike - strikePadding,
      maxStrike + strikePadding
    ];

    const currentTheoSpot = currentTheoEsSpot();

    let theoRange = strikeRange;

    if (theoValues.length || Number.isFinite(currentTheoSpot)) {
      const theoRangeValues = [...theoValues];

      // Include the current Theo ES Spot in the secondary-axis range so the
      // reference line never disappears just outside the auto-derived range.
      if (Number.isFinite(currentTheoSpot)) {
        theoRangeValues.push(currentTheoSpot);
      }

      const minTheo = Math.min(...theoRangeValues);
      const maxTheo = Math.max(...theoRangeValues);
      const theoSpan = Math.max(maxTheo - minTheo, medianStrikeStep);

      const theoPadding = Math.max(
        medianStrikeStep * 0.7,
        theoSpan * 0.045
      );

      theoRange = [
        minTheo - theoPadding,
        maxTheo + theoPadding
      ];
    }

    const currentTheoShape = Number.isFinite(currentTheoSpot)
      ? [{
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          yref: "y2",
          y0: currentTheoSpot,
          y1: currentTheoSpot,
          layer: "above",
          line: {
            color: "#f4b942",
            width: 2,
            dash: "solid"
          }
        }]
      : [];

    const currentTheoAnnotation = Number.isFinite(currentTheoSpot)
      ? [{
          xref: "paper",
          x: 1.008,
          xanchor: "left",
          yref: "y2",
          y: currentTheoSpot,
          yanchor: "middle",
          text: formatNumber(currentTheoSpot),
          showarrow: false,
          bgcolor: "rgba(13,22,33,.94)",
          bordercolor: "rgba(244,185,66,.55)",
          borderwidth: 1,
          borderpad: 3,
          font: {
            size: 10,
            color: "#f4b942"
          }
        }]
      : [];

    const baseChartHeight = Math.max(
      480,
      Math.min(1100, activeRows.length * 27 + 165)
    );

    setElementGraphHeight(chartId, baseChartHeight);

    Plotly.react(
      chartId,
      traces,
      {
        ...baseLayout,
        barmode: metricCount > 1 ? "group" : "relative",
        bargap: metricCount > 1 ? 0.20 : 0.18,
        bargroupgap: metricCount > 1 ? 0.08 : 0,
        hovermode: "closest",
        margin: { l: 92, r: 132, t: 34, b: 56 },

        // Current Theo ES Spot is shown as a solid yellow line spanning the
        // complete plot width. yref="y2" ties it directly to the right-side
        // Theo ES axis rather than the left Strike axis.
        shapes: currentTheoShape,
        annotations: currentTheoAnnotation,

        xaxis: {
          ...baseLayout.xaxis,
          title: {
            text: specs.some((spec) => !spec.single)
              ? "Calls (+) / Puts (mirrored)"
              : "Value",
            font: { size: 10 }
          },
          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none",
          automargin: true
        },

        yaxis: {
          ...baseLayout.yaxis,
          title: {
            text: "Strike",
            standoff: 8,
            font: { size: 11 }
          },
          type: "linear",
          range: strikeRange,
          tickmode: "array",
          tickvals: strikes,
          ticktext: strikes.map(formatNumber),
          tickfont: { size: 9 },
          ticks: "outside",
          ticklen: 4,
          automargin: true
        },

        yaxis2: {
          title: {
            text: "Theo ES",
            standoff: 10,
            font: { size: 11, color: "#f4b942" }
          },
          overlaying: "y",
          side: "right",
          type: "linear",
          range: theoRange,
          nticks: 8,
          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none",
          tickfont: { size: 9, color: "#f4b942" },
          tickcolor: "#f4b942",
          ticks: "outside",
          ticklen: 5,
          showgrid: false,
          zeroline: false,
          automargin: true
        },

        legend: {
          orientation: "h",
          x: 0,
          y: 1.045,
          xanchor: "left",
          yanchor: "bottom",
          font: { size: 10 }
        }
      },
      plotConfig
    );
  }

  function renderAllVoltra() {
    for (let index = 1; index <= state.snapshotChartCount; index++) {
      renderVoltra(index);
    }
  }

  async function loadVoltra() {
    [1, 2].forEach((index) => clearError(`voltraError${index}`));

    try {
      const bucket = C.buckets[state.bucket];
      const text = await fetchText(raw("Voltra", bucket.voltra));

      state.voltra = parseCSV(text);

      const timestamp = state.voltra
        .map((row) => row.timestamp)
        .filter(Boolean)
        .map(String)
        .sort()
        .at(-1);

      [1, 2].forEach((index) => {
        $(`voltraTimestamp${index}`).textContent =
          timestamp ? `As of ${timestamp}` : "Latest";
      });

      renderAllVoltra();
    } catch (error) {
      for (let index = 1; index <= state.snapshotChartCount; index++) {
        showError(
          `voltraError${index}`,
          `Could not load Voltra: ${error.message}`
        );
      }
    }
  }

  function initializeSnapshotControls() {
    $("strikeChartCount").value = String(state.snapshotChartCount);
    $("visualChartCount").value = String(state.visualChartCount);

    [1, 2].forEach((index) => {
      const chartState = snapshotChartState(index);
      $(`snapshotMetric${index}`).value = chartState.metric;
      initializeMultiMetricOptions(index);

      const visualSelect = $(`visualBucket${index}`);
      visualSelect.innerHTML = "";

      for (const [key, bucket] of Object.entries(C.buckets)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = bucket.label;
        visualSelect.appendChild(option);
      }

      visualSelect.value = state.visualBuckets[index - 1];
    });

    updateSnapshotChartVisibility();
    updateVisualChartVisibility();
  }

  // ---------------------------------------------------------------------------
  // BRENT BS VISUALS
  // ---------------------------------------------------------------------------

  function updateVisualChartVisibility() {
    [1, 2].forEach((index) => {
      const visible = index <= state.visualChartCount;
      $(`visualPanel${index}`).classList.toggle("hidden", !visible);

      if (visible) {
        resizeEmbeddedVisual(index);
      }
    });
  }

  async function loadVisual(index = 1) {
    const errorId = `visualError${index}`;
    const titleId = `visualTitle${index}`;
    const sourceId = `visualSourceLink${index}`;
    const loadingId = `visualLoading${index}`;
    const frameId = `visualFrame${index}`;

    clearError(errorId);

    const bucketKey =
      state.visualBuckets[index - 1] ||
      (index === 1 ? "0dte" : "1dte");

    const bucket = C.buckets[bucketKey];
    const file = `${bucket.visualPrefix}_brent_bs_${state.greek}.html`;

    $(titleId).textContent = `${bucket.label} ${state.greek}`;
    $(sourceId).href =
      `https://github.com/CBCharts/BrentBSVisuals/blob/main/${file}`;

    $(loadingId).classList.remove("hidden");
    $(frameId).classList.add("hidden");

    resizeEmbeddedVisual(index);

    try {
      const rawHtml = await fetchText(raw("BrentBSVisuals", file));
      const extractedSpxSpot = extractSpxSpotFromPlotlyHtml(rawHtml);

      // Plotly slot 1 is the canonical SPX source for the persistent top bar.
      if (index === 1) {
        state.spxSpot = Number.isFinite(extractedSpxSpot)
          ? extractedSpxSpot
          : null;

        renderSpotPrices();

        if (state.voltra.length) {
          renderAllVoltra();
        }
      }

      const responsiveHtml = makeEmbeddedPlotlyResponsive(rawHtml);

      $(frameId).onload = () => {
        $(loadingId).classList.add("hidden");
        $(frameId).classList.remove("hidden");

        setTimeout(() => resizeEmbeddedVisual(index), 50);
        setTimeout(() => resizeEmbeddedVisual(index), 250);
      };

      $(frameId).srcdoc = responsiveHtml;
    } catch (error) {
      if (index === 1) {
        state.spxSpot = null;
        renderSpotPrices();

        if (state.voltra.length) {
          renderAllVoltra();
        }
      }

      $(loadingId).classList.add("hidden");

      showError(
        errorId,
        `Could not load BrentBSVisuals: ${error.message}`
      );
    }
  }

  async function loadVisuals() {
    const jobs = [];

    for (let index = 1; index <= state.visualChartCount; index++) {
      jobs.push(loadVisual(index));
    }

    await Promise.allSettled(jobs);
  }

  // ---------------------------------------------------------------------------
  // PUSHERMAN TIMELAPSE
  // ---------------------------------------------------------------------------

  function ymd(value) {
    return String(value || "").replaceAll("-", "");
  }

  function historicalPath(date) {
    return `${date}/brent_bs/${C.buckets[state.bucket].pusherman}`;
  }

  function rankedKeys() {
    return [1, 2, 3, 4, 5]
      .map((rank) => `Call ${state.greek} ${rank}`)
      .concat([1, 2, 3, 4, 5].map((rank) => `Put ${state.greek} ${rank}`));
  }

  function buildHistory(rows) {
    const framesByTimestamp = new Map();

    for (const row of rows) {
      if (
        row.Greek !== state.greek ||
        !row.timestamp ||
        !Number.isFinite(Number(row.strikePrice))
      ) {
        continue;
      }

      if (!framesByTimestamp.has(row.timestamp)) {
        framesByTimestamp.set(row.timestamp, {
          timestamp: row.timestamp,
          theo: Number(row["Theo ES"]),
          ranks: {}
        });
      }

      framesByTimestamp.get(row.timestamp).ranks[row.Rank] = {
        strike: Number(row.strikePrice),
        value: Number(row.Value)
      };
    }

    return {
      frames: [...framesByTimestamp.values()].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp)
      ),
      keys: rankedKeys()
    };
  }

  const TIMELAPSE_CALL_COLORS = [
    "#4ca7ff",
    "#67b6ff",
    "#82c4ff",
    "#9bd1ff",
    "#b4ddff"
  ];

  const TIMELAPSE_PUT_COLORS = [
    "#ff626d",
    "#ff7a83",
    "#ff929b",
    "#ffabb1",
    "#ffc1c6"
  ];

  function timelapseRankColor(key, index) {
    return key.startsWith("Call")
      ? TIMELAPSE_CALL_COLORS[index]
      : TIMELAPSE_PUT_COLORS[index - 5];
  }

  function updateTimelapseModeButtons() {
    document.querySelectorAll(".timelapse-mode-button").forEach((button) => {
      const active = button.dataset.mode === state.timelapseMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const chartLabel = $("timelapseChartLabel");

    if (chartLabel) {
      chartLabel.textContent =
        state.timelapseMode === "bars"
          ? "Ranked value bars"
          : "Ranked level lines";
    }
  }

  function setTimelapseMode(mode) {
    const nextMode = mode === "bars" ? "bars" : "levels";

    if (state.timelapseMode === nextMode) return;

    state.timelapseMode = nextMode;
    updateTimelapseModeButtons();

    if (!state.history?.frames.length) return;

    renderHistory(state.history, state.frame);
  }

  function renderRankedLevelHistory(history) {
    const traces = history.keys.map((key, index) => ({
      type: "scatter",
      mode: "lines",
      name: key,
      x: history.frames.map((frame) => frame.timestamp),
      y: history.frames.map((frame) => frame.ranks[key]?.strike ?? null),
      connectgaps: false,
      line: {
        width: 1.7,
        color: timelapseRankColor(key, index)
      },
      hovertemplate:
        `<b>${key}</b>` +
        "<br>Time: %{x}" +
        "<br>Strike: %{y:,.3~f}" +
        "<extra></extra>"
    }));

    // Current-frame markers. Theo ES has intentionally been removed from
    // this chart in v0.7.
    traces.push({
      type: "scatter",
      mode: "markers+text",
      name: "Current frame",
      x: [],
      y: [],
      text: [],
      textposition: "middle right",
      textfont: { size: 9, color: "#eef4fb" },
      marker: {
        size: 8,
        color: history.keys.map((key, index) =>
          timelapseRankColor(key, index)
        ),
        line: {
          width: 1,
          color: "#071018"
        }
      },
      hoverinfo: "skip",
      showlegend: false
    });

    Plotly.react(
      "timelapseChart",
      traces,
      {
        ...baseLayout,
        hovermode: "x unified",
        margin: { l: 70, r: 72, t: 30, b: 55 },
        xaxis: {
          ...baseLayout.xaxis,
          title: { text: "Time" }
        },
        yaxis: {
          ...baseLayout.yaxis,
          title: { text: "Strike" },
          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none"
        },
        legend: {
          orientation: "h",
          y: 1.08,
          x: 0,
          font: { size: 9 }
        }
      },
      plotConfig
    );
  }

  function rankedBarFrameData(frame, history) {
    return history.keys
      .map((key, index) => {
        const point = frame.ranks[key];

        if (
          !point ||
          !Number.isFinite(Number(point.strike)) ||
          !Number.isFinite(Number(point.value))
        ) {
          return null;
        }

        return {
          key,
          index,
          strike: Number(point.strike),
          value: Number(point.value),
          side: key.startsWith("Call") ? "Call" : "Put",
          color: timelapseRankColor(key, index)
        };
      })
      .filter(Boolean);
  }

  function rankedBarSessionRange(history) {
    const strikes = [];

    history.frames.forEach((frame) => {
      history.keys.forEach((key) => {
        const strike = Number(frame.ranks[key]?.strike);
        if (Number.isFinite(strike)) {
          strikes.push(strike);
        }
      });
    });

    if (!strikes.length) {
      return {
        range: [0, 1],
        barWidth: 1,
        tickSize: 1
      };
    }

    const unique = [...new Set(strikes)].sort((a, b) => a - b);

    const diffs = unique
      .slice(1)
      .map((strike, index) => strike - unique[index])
      .filter((diff) => Number.isFinite(diff) && diff > 0)
      .sort((a, b) => a - b);

    const typicalStep = diffs.length
      ? diffs[Math.floor(diffs.length / 2)]
      : 25;

    const minStrike = unique[0];
    const maxStrike = unique[unique.length - 1];
    const span = Math.max(maxStrike - minStrike, typicalStep);
    const padding = Math.max(typicalStep * 1.25, span * 0.05);

    return {
      range: [minStrike - padding, maxStrike + padding],
      // Width is measured in Y-axis strike units for horizontal bars.
      barWidth: Math.max(1, typicalStep * 0.62),
      tickSize: typicalStep
    };
  }

  function renderRankedBarFrame(frame, history) {
    const points = rankedBarFrameData(frame, history);

    if (!points.length) {
      Plotly.purge("timelapseChart");
      showError(
        "timelapseError",
        `No ranked ${state.greek} values are available for ${frame.timestamp}.`
      );
      return;
    }

    clearError("timelapseError");

    const session = rankedBarSessionRange(history);

    /*
      IMPORTANT:
      Y is now the REAL NUMERIC strike price.

      v0.7 used categorical strings such as:
          "7700|Call GEX 1"

      That locked each rank to a visual row. In v0.7.1 the actual
      numeric strike is passed to Plotly, so the bars physically
      move up/down the strike axis as the timelapse advances.
    */
    const traces = points.map((point) => ({
      type: "bar",
      orientation: "h",
      name: point.key,
      x: [point.value],
      y: [point.strike],
      width: [session.barWidth],
      marker: {
        color: point.color,
        line: {
          color: "rgba(255,255,255,.14)",
          width: 1
        }
      },
      customdata: [[
        point.key,
        formatNumber(point.strike),
        formatNumber(point.value)
      ]],
      text: [point.key],
      textposition: "auto",
      insidetextanchor: "middle",
      cliponaxis: false,
      hovertemplate:
        "<b>%{customdata[0]}</b>" +
        "<br>Strike: %{customdata[1]}" +
        `<br>${state.greek} Value: %{customdata[2]}` +
        "<extra></extra>",
      showlegend: false
    }));

    // Current frame strike ticks only. The fixed numeric Y-range keeps
    // movement comparable across the entire session.
    const currentStrikes = [...new Set(
      points
        .map((point) => point.strike)
        .filter(Number.isFinite)
    )].sort((a, b) => a - b);

    Plotly.react(
      "timelapseChart",
      traces,
      {
        ...baseLayout,

        // If two ranks land on the exact same strike, Plotly groups them
        // around that strike instead of converting the axis to categories.
        barmode: "group",
        bargap: 0.18,
        bargroupgap: 0.08,

        margin: { l: 86, r: 32, t: 34, b: 60 },

        xaxis: {
          ...baseLayout.xaxis,
          title: {
            text: `${state.greek} Value`,
            font: { size: 10 }
          },
          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none",
          zeroline: true,
          zerolinecolor: "rgba(255,255,255,.34)",
          zerolinewidth: 1,
          automargin: true
        },

        yaxis: {
          ...baseLayout.yaxis,
          title: {
            text: "Strike",
            font: { size: 11 }
          },

          // Numeric axis is the key fix.
          type: "linear",
          range: session.range,

          // Label the 10 current strikes while retaining their true
          // numeric spacing/position on the axis.
          tickmode: "array",
          tickvals: currentStrikes,
          ticktext: currentStrikes.map(formatNumber),

          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none",
          ticks: "outside",
          ticklen: 4,
          automargin: true
        },

        showlegend: false,

        annotations: [{
          xref: "paper",
          yref: "paper",
          x: 1,
          y: 1.055,
          xanchor: "right",
          yanchor: "bottom",
          showarrow: false,
          text: frame.timestamp,
          font: {
            size: 10,
            color: "#8ea0b6"
          }
        }]
      },
      plotConfig
    );
  }

  function renderHistory(history, requestedFrame = 0) {
    if (!history.frames.length) {
      throw new Error("No matching ranked rows found.");
    }

    setElementGraphHeight("timelapseChart", 560);
    updateTimelapseModeButtons();

    const safeFrame = Math.max(
      0,
      Math.min(
        Number(requestedFrame) || 0,
        history.frames.length - 1
      )
    );

    if (state.timelapseMode === "bars") {
      renderRankedBarFrame(history.frames[safeFrame], history);
    } else {
      renderRankedLevelHistory(history);
    }

    $("timelineSlider").max = String(history.frames.length - 1);
    $("timelineSlider").value = String(safeFrame);
    state.frame = safeFrame;
    updateFrame(safeFrame);
  }

  function renderCurrentLevelGrid(frame) {
    $("levelGrid").innerHTML = state.history.keys.map((key) => {
      const point = frame.ranks[key];

      return `
        <div class="level-chip ${key.startsWith("Call") ? "call" : "put"}">
          <div class="rank">${key}</div>
          <div class="strike">
            ${point ? formatNumber(point.strike) : "—"}
          </div>
          <div class="level-value">
            ${point ? formatNumber(point.value) : "—"}
          </div>
        </div>
      `;
    }).join("");
  }

  function updateRankedLevelCurrentFrame(frame) {
    const markerX = [];
    const markerY = [];
    const markerText = [];

    for (const key of state.history.keys) {
      if (!frame.ranks[key]) continue;

      markerX.push(frame.timestamp);
      markerY.push(frame.ranks[key].strike);
      markerText.push(key.replace(` ${state.greek} `, " "));
    }

    // There are exactly 10 ranked line traces, followed by the current-frame
    // marker trace. Theo ES no longer occupies a trace index.
    Plotly.restyle(
      "timelapseChart",
      {
        x: [markerX],
        y: [markerY],
        text: [markerText]
      },
      [state.history.keys.length]
    );

    Plotly.relayout("timelapseChart", {
      shapes: [{
        type: "line",
        x0: frame.timestamp,
        x1: frame.timestamp,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: {
          color: "rgba(255,255,255,.24)",
          width: 1,
          dash: "dot"
        }
      }]
    });
  }

  function updateFrame(index) {
    if (!state.history?.frames.length) return;

    const safeIndex = Math.max(
      0,
      Math.min(
        Number(index) || 0,
        state.history.frames.length - 1
      )
    );

    state.frame = safeIndex;
    const frame = state.history.frames[safeIndex];

    $("timelineSlider").value = String(safeIndex);
    $("timelineLabel").textContent = frame.timestamp;

    $("frameTheo").textContent = Number.isFinite(frame.theo)
      ? `Theo ES ${formatNumber(frame.theo)}`
      : "Theo ES —";

    if (state.timelapseMode === "bars") {
      renderRankedBarFrame(frame, state.history);
    } else {
      updateRankedLevelCurrentFrame(frame);
    }

    renderCurrentLevelGrid(frame);
  }

  function folderToDateInput(folder) {
    const text = String(folder || "");

    if (!/^\d{8}$/.test(text)) return "";

    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  function formatHistoryDateForMessage(folder) {
    const text = String(folder || "");

    if (!/^\d{8}$/.test(text)) return text;

    // Requested display format: MMDDYYYY
    return `${text.slice(4, 6)}${text.slice(6, 8)}${text.slice(0, 4)}`;
  }

  function closeHistoryDateNotice() {
    if (state.historyDateNoticeTimer) {
      clearTimeout(state.historyDateNoticeTimer);
      state.historyDateNoticeTimer = null;
    }

    $("historyDateNotice").classList.add("hidden");
  }

  function showHistoryDateNotice(requestedFolder) {
    closeHistoryDateNotice();

    $("historyDateNoticeText").textContent =
      `No Data Available for ${formatHistoryDateForMessage(requestedFolder)}, ` +
      `Reverting to Most Recent Date`;

    $("historyDateNotice").classList.remove("hidden");

    state.historyDateNoticeTimer = setTimeout(() => {
      closeHistoryDateNotice();
    }, 3000);
  }

  async function resolveHistoryFolder(requestedFolder) {
    let folders = await getLatestPushermanFolders();

    if (folders.includes(requestedFolder)) {
      return requestedFolder;
    }

    // Re-check GitHub once before declaring the date unavailable. This avoids
    // a false fallback if the cached folder list is a few minutes behind.
    folders = await getLatestPushermanFolders(true);

    if (folders.includes(requestedFolder)) {
      return requestedFolder;
    }

    const latestFolder = folders[0];

    if (!latestFolder) {
      throw new Error("No Pusherman3000 date folders are available.");
    }

    showHistoryDateNotice(requestedFolder);

    const latestDate = folderToDateInput(latestFolder);
    $("historyDate").value = latestDate;
    $("historyDate").max = latestDate;

    return latestFolder;
  }

  async function initializeLatestHistoryDate() {
    try {
      const folders = await getLatestPushermanFolders(true);
      const latestFolder = folders[0];
      const latestDate = folderToDateInput(latestFolder);

      if (!latestDate) return;

      $("historyDate").value = latestDate;
      $("historyDate").max = latestDate;
    } catch (error) {
      console.warn("Could not initialize latest Timelapse date:", error);
    }
  }

  async function loadHistory() {
    stopPlayback();
    clearError("timelapseError");

    const requestedDate = ymd($("historyDate").value);

    if (!requestedDate) {
      return;
    }

    $("timelineLabel").textContent = "Loading session…";

    try {
      const date = await resolveHistoryFolder(requestedDate);

      const text = await fetchText(
        raw("pusherman3000", historicalPath(date), false)
      );

      state.history = buildHistory(parseCSV(text));
      renderHistory(state.history);
    } catch (error) {
      state.history = null;
      $("timelineLabel").textContent = "Session unavailable";

      showError(
        "timelapseError",
        `Could not load ${ymd($("historyDate").value)} ` +
        `${C.buckets[state.bucket].label} ${state.greek}: ${error.message}`
      );
    }
  }

  const PLAYBACK_BASE_DELAY_MS = 180;

  function playbackDelayMs() {
    const speed = Number(state.playbackSpeed);

    if (!Number.isFinite(speed) || speed <= 0) {
      return PLAYBACK_BASE_DELAY_MS;
    }

    // Protect the browser from extremely aggressive Plotly redraw loops.
    return Math.max(70, Math.round(PLAYBACK_BASE_DELAY_MS / speed));
  }

  function playbackTick() {
    if (!state.history?.frames.length) return;

    const lastIndex = state.history.frames.length - 1;

    if (state.frame >= lastIndex) {
      state.playbackPassesCompleted += 1;

      if (state.playbackPassesCompleted >= 2) {
        stopPlayback();
        $("playButton").title =
          "Playback complete: two passes finished. Press Play to run again.";
        return;
      }

      updateFrame(0);
      return;
    }

    updateFrame(state.frame + 1);
  }

  function schedulePlayback() {
    if (state.playTimer) {
      clearInterval(state.playTimer);
    }

    state.playTimer = setInterval(
      playbackTick,
      playbackDelayMs()
    );
  }

  function startPlayback() {
    if (!state.history?.frames.length) return;

    if (state.playTimer) {
      stopPlayback();
      return;
    }

    // Every new Play action is allowed a maximum of two passes.
    state.playbackPassesCompleted = 0;

    if (state.frame >= state.history.frames.length - 1) {
      updateFrame(0);
    }

    $("playButton").textContent = "❚❚ Pause";
    $("playButton").title = "Pause timelapse playback";
    schedulePlayback();
  }

  function stopPlayback() {
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    $("playButton").textContent = "▶ Play";
  }

  function setPlaybackSpeed(value) {
    const speed = Number(value);

    state.playbackSpeed =
      Number.isFinite(speed) && speed > 0
        ? speed
        : 1;

    const select = $("playbackSpeedSelect");
    if (select) {
      select.value = String(state.playbackSpeed);
    }

    // If currently playing, immediately apply the new interval without
    // resetting the current frame or changing chart mode.
    if (state.playTimer) {
      schedulePlayback();
    }
  }

  // ---------------------------------------------------------------------------
  // REPOS + PINESCRIPT
  // ---------------------------------------------------------------------------

  function renderRepos() {
    $("repoGrid").innerHTML = Object.values(C.repos).map((repo) => `
      <a class="repo-card" href="${repo.url}" target="_blank" rel="noopener">
        <div class="panel-kicker">GitHub source</div>
        <h3>${repo.name}</h3>
        <p>${repo.description}</p>
        <div class="repo-meta">
          <span>CBCharts/${repo.name}</span>
          <span>Open ↗</span>
        </div>
      </a>
    `).join("");
  }

  const PINE_SCRIPT_TEMPLATE = "//@version=6\nindicator(\"Hardcoded GEX Levels\", \"GEX Levels\", overlay = true, max_lines_count = 500, max_labels_count = 500)\n\n// ────────────────────────────────\n// USER-DEFINED TYPES\n// ────────────────────────────────\ntype GexLevel\n    float  price\n    string rank\n    float  value\n\ntype GexBatch\n    string name\n    color  clr\n    array<GexLevel> levels\n\n// Bucket wraps arrays so we can store an array-of-buckets and index them via a map\ntype Bucket\n    array<float> values   // raw values collected for this price\n    array<float> sorted   // sorted copy (descending) for label order\n\n// ────────────────────────────────\n// DEFAULT PALETTES (hex literals)\n// ────────────────────────────────\nvar color DEF_0DTE_COL = #CFEEDB   // mint\nvar color DEF_1DTE_COL = #FFF6C9   // pale yellow\nvar color DEF_EOW_COL  = #FFA726   // orange\nvar color DEF_EOM_COL  = #FF5252   // dark red\nvar color DEF_NW_COL   = #FFF6C9   // pale yellow\nvar color DEF_NM_COL   = #FFB74D   // light orange\nvar color DEF_FULL_COL = #A1272A   // dark red\n\n// Call ramp (reds) darkest → lightest\nvar color DEF_CALL_1 = #8B1E2C\nvar color DEF_CALL_2 = #B22234\nvar color DEF_CALL_3 = #E05562\nvar color DEF_CALL_4 = #F28A93\nvar color DEF_CALL_5 = #F8B8BE\n\n// Put ramp (greens) darkest → lightest\nvar color DEF_PUT_1  = #0E402E\nvar color DEF_PUT_2  = #1E6F3A\nvar color DEF_PUT_3  = #2E8B57\nvar color DEF_PUT_4  = #7ECF8A\nvar color DEF_PUT_5  = #CFEED6\n\n// ────────────────────────────────\n// HARDCODED GEX DATA (Generated by Python on {generation_date})\n// ────────────────────────────────\n{gex_data_block}\n// ────────────────────────────────\n// GROUP INTO ARRAYS\n// ────────────────────────────────\nvar gex_data_0dte = array.from(gex_0dte_c1, gex_0dte_c2, gex_0dte_c3, gex_0dte_c4, gex_0dte_c5, gex_0dte_p1, gex_0dte_p2, gex_0dte_p3, gex_0dte_p4, gex_0dte_p5)\nvar gex_data_1dte = array.from(gex_1dte_c1, gex_1dte_c2, gex_1dte_c3, gex_1dte_c4, gex_1dte_c5, gex_1dte_p1, gex_1dte_p2, gex_1dte_p3, gex_1dte_p4, gex_1dte_p5)\nvar gex_data_eow  = array.from(gex_eow_c1, gex_eow_c2, gex_eow_c3, gex_eow_c4, gex_eow_c5, gex_eow_p1, gex_eow_p2, gex_eow_p3, gex_eow_p4, gex_eow_p5)\nvar gex_data_eom  = array.from(gex_eom_c1, gex_eom_c2, gex_eom_c3, gex_eom_c4, gex_eom_c5, gex_eom_p1, gex_eom_p2, gex_eom_p3, gex_eom_p4, gex_eom_p5)\nvar gex_data_nw   = array.from(gex_nw_c1,  gex_nw_c2,  gex_nw_c3,  gex_nw_c4,  gex_nw_c5,  gex_nw_p1,  gex_nw_p2,  gex_nw_p3,  gex_nw_p4,  gex_nw_p5)\nvar gex_data_nm   = array.from(gex_nm_c1,  gex_nm_c2,  gex_nm_c3,  gex_nm_c4,  gex_nm_c5,  gex_nm_p1,  gex_nm_p2,  gex_nm_p3,  gex_nm_p4,  gex_nm_p5)\nvar gex_data_full = array.from(gex_full_c1, gex_full_c2, gex_full_c3, gex_full_c4, gex_full_c5, gex_full_p1, gex_full_p2, gex_full_p3, gex_full_p4, gex_full_p5)\n\n// ────────────────────────────────\n// GLOBAL INPUTS (visibility, ranks, colors, layout)\n// ────────────────────────────────\ng_visibility_title = \"Data Table Visibility\"\nshow_0dte  = input.bool(true, \"0DTE\",       group = g_visibility_title, inline = \"d1\")\nshow_1dte  = input.bool(true, \"1DTE\",       group = g_visibility_title, inline = \"d1\")\nshow_eow   = input.bool(true, \"EoW\",        group = g_visibility_title, inline = \"d2\")\nshow_eom   = input.bool(true, \"EoM\",        group = g_visibility_title, inline = \"d2\")\nshow_nw    = input.bool(true, \"Next Week\",  group = g_visibility_title, inline = \"d3\")\nshow_nm    = input.bool(true, \"Next Month\", group = g_visibility_title, inline = \"d3\")\nshow_full  = input.bool(true, \"Full\",       group = g_visibility_title, inline = \"d4\")\n\ng_batch_colors = \"BATCH COLOR SETTINGS\"\nbatch_col_0dte = input.color(DEF_0DTE_COL, \"0DTE\",       group = g_batch_colors, inline = \"bc1\")\nbatch_col_1dte = input.color(DEF_1DTE_COL, \"1DTE\",       group = g_batch_colors, inline = \"bc1\")\nbatch_col_eow  = input.color(DEF_EOW_COL,  \"EoW\",        group = g_batch_colors, inline = \"bc2\")\nbatch_col_eom  = input.color(DEF_EOM_COL,  \"EoM\",        group = g_batch_colors, inline = \"bc2\")\nbatch_col_nw   = input.color(DEF_NW_COL,   \"Next Week\",  group = g_batch_colors, inline = \"bc3\")\nbatch_col_nm   = input.color(DEF_NM_COL,   \"Next Month\", group = g_batch_colors, inline = \"bc3\")\nbatch_col_full = input.color(DEF_FULL_COL, \"Full\",       group = g_batch_colors, inline = \"bc4\")\n\ng_call_title = \"CALL GEX LEVEL SETTINGS\"\nshow_call_gex_1  = input.bool(true, \"Call GEX 1\", group = g_call_title, inline = \"cg1\")\ncolor_call_gex_1 = input.color(DEF_CALL_1, \"\", group = g_call_title, inline = \"cg1\")\nstyle_call_gex_1 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_call_title, inline = \"cg1\")\nwidth_call_gex_1 = input.int(2, \"\", minval = 1, maxval = 5, group = g_call_title, inline = \"cg1\")\n\nshow_call_gex_2  = input.bool(true, \"Call GEX 2\", group = g_call_title, inline = \"cg2\")\ncolor_call_gex_2 = input.color(DEF_CALL_2, \"\", group = g_call_title, inline = \"cg2\")\nstyle_call_gex_2 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_call_title, inline = \"cg2\")\nwidth_call_gex_2 = input.int(2, \"\", minval = 1, maxval = 5, group = g_call_title, inline = \"cg2\")\n\nshow_call_gex_3  = input.bool(true, \"Call GEX 3\", group = g_call_title, inline = \"cg3\")\ncolor_call_gex_3 = input.color(DEF_CALL_3, \"\", group = g_call_title, inline = \"cg3\")\nstyle_call_gex_3 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_call_title, inline = \"cg3\")\nwidth_call_gex_3 = input.int(2, \"\", minval = 1, maxval = 5, group = g_call_title, inline = \"cg3\")\n\nshow_call_gex_4  = input.bool(true, \"Call GEX 4\", group = g_call_title, inline = \"cg4\")\ncolor_call_gex_4 = input.color(DEF_CALL_4, \"\", group = g_call_title, inline = \"cg4\")\nstyle_call_gex_4 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_call_title, inline = \"cg4\")\nwidth_call_gex_4 = input.int(1, \"\", minval = 1, maxval = 5, group = g_call_title, inline = \"cg4\")\n\nshow_call_gex_5  = input.bool(true, \"Call GEX 5\", group = g_call_title, inline = \"cg5\")\ncolor_call_gex_5 = input.color(DEF_CALL_5, \"\", group = g_call_title, inline = \"cg5\")\nstyle_call_gex_5 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_call_title, inline = \"cg5\")\nwidth_call_gex_5 = input.int(1, \"\", minval = 1, maxval = 5, group = g_call_title, inline = \"cg5\")\n\ng_put_title = \"PUT GEX LEVEL SETTINGS\"\nshow_put_gex_1  = input.bool(true, \"Put GEX 1\", group = g_put_title, inline = \"pg1\")\ncolor_put_gex_1 = input.color(DEF_PUT_1, \"\", group = g_put_title, inline = \"pg1\")\nstyle_put_gex_1 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_put_title, inline = \"pg1\")\nwidth_put_gex_1 = input.int(2, \"\", minval = 1, maxval = 5, group = g_put_title, inline = \"pg1\")\n\nshow_put_gex_2  = input.bool(true, \"Put GEX 2\", group = g_put_title, inline = \"pg2\")\ncolor_put_gex_2 = input.color(DEF_PUT_2, \"\", group = g_put_title, inline = \"pg2\")\nstyle_put_gex_2 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_put_title, inline = \"pg2\")\nwidth_put_gex_2 = input.int(2, \"\", minval = 1, maxval = 5, group = g_put_title, inline = \"pg2\")\n\nshow_put_gex_3  = input.bool(true, \"Put GEX 3\", group = g_put_title, inline = \"pg3\")\ncolor_put_gex_3 = input.color(DEF_PUT_3, \"\", group = g_put_title, inline = \"pg3\")\nstyle_put_gex_3 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_put_title, inline = \"pg3\")\nwidth_put_gex_3 = input.int(2, \"\", minval = 1, maxval = 5, group = g_put_title, inline = \"pg3\")\n\nshow_put_gex_4  = input.bool(true, \"Put GEX 4\", group = g_put_title, inline = \"pg4\")\ncolor_put_gex_4 = input.color(DEF_PUT_4, \"\", group = g_put_title, inline = \"pg4\")\nstyle_put_gex_4 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_put_title, inline = \"pg4\")\nwidth_put_gex_4 = input.int(1, \"\", minval = 1, maxval = 5, group = g_put_title, inline = \"pg4\")\n\nshow_put_gex_5  = input.bool(true, \"Put GEX 5\", group = g_put_title, inline = \"pg5\")\ncolor_put_gex_5 = input.color(DEF_PUT_5, \"\", group = g_put_title, inline = \"pg5\")\nstyle_put_gex_5 = input.string(\"Solid\", \"\", options = [\"Solid\",\"Dotted\",\"Dashed\"], group = g_put_title, inline = \"pg5\")\nwidth_put_gex_5 = input.int(1, \"\", minval = 1, maxval = 5, group = g_put_title, inline = \"pg5\")\n\n// ────────────────────────────────\n// LAYOUT (new)\n// ────────────────────────────────\ng_layout = \"Layout\"\nright_shift_bars = input.int(40, \"Label horizontal offset (bars)\", minval = 0, maxval = 1000, group = g_layout)\nanchor_from_last = input.bool(true,  \"Anchor from last bar\",           group = g_layout, tooltip = \"Anchor labels from last_bar_index instead of current bar.\")\nextend_right     = input.bool(true,  \"Make labels extend to the right\", group = g_layout, tooltip = \"Use style_label_left so the box grows to the right of the anchor.\")\n\n// ────────────────────────────────\n// COMBINE BATCHES (customizable colors)\n// ────────────────────────────────\nvar array<GexBatch> all_batches = array.new<GexBatch>()\nif barstate.isfirst\n    array.push(all_batches, GexBatch.new(\"0DTE\",       batch_col_0dte, gex_data_0dte))\n    array.push(all_batches, GexBatch.new(\"1DTE\",       batch_col_1dte, gex_data_1dte))\n    array.push(all_batches, GexBatch.new(\"EoW\",        batch_col_eow,  gex_data_eow))\n    array.push(all_batches, GexBatch.new(\"EoM\",        batch_col_eom,  gex_data_eom))\n    array.push(all_batches, GexBatch.new(\"Next Week\",  batch_col_nw,   gex_data_nw))\n    array.push(all_batches, GexBatch.new(\"Next Month\", batch_col_nm,   gex_data_nm))\n    array.push(all_batches, GexBatch.new(\"Full\",       batch_col_full, gex_data_full))\n\n// ────────────────────────────────\n// HELPERS\n// ────────────────────────────────\nf_getLineStyle(string styleString) =>\n    s = line.style_solid\n    if styleString == \"Dotted\"\n        s := line.style_dotted\n    else if styleString == \"Dashed\"\n        s := line.style_dashed\n    s\n\nf_priceToTicks(float px) =>\n    syminfo.mintick > 0 ? int(math.round(px / syminfo.mintick)) : int(math.round(px / 0.25))\n\nf_ticksToPrice(int ticks) =>\n    syminfo.mintick > 0 ? ticks * syminfo.mintick : ticks * 0.25\n\n// Settings resolver for ranks (global control)\nf_rankSettings(string rank) =>\n    bool showLevel = false\n    color lineColor = na\n    string lineStyleString = \"\"\n    int lineWidth = 1\n    if       rank == \"Call GEX 1\"\n        showLevel := show_call_gex_1\n        lineColor := color_call_gex_1\n        lineStyleString := style_call_gex_1\n        lineWidth := width_call_gex_1\n    else if rank == \"Call GEX 2\"\n        showLevel := show_call_gex_2\n        lineColor := color_call_gex_2\n        lineStyleString := style_call_gex_2\n        lineWidth := width_call_gex_2\n    else if rank == \"Call GEX 3\"\n        showLevel := show_call_gex_3\n        lineColor := color_call_gex_3\n        lineStyleString := style_call_gex_3\n        lineWidth := width_call_gex_3\n    else if rank == \"Call GEX 4\"\n        showLevel := show_call_gex_4\n        lineColor := color_call_gex_4\n        lineStyleString := style_call_gex_4\n        lineWidth := width_call_gex_4\n    else if rank == \"Call GEX 5\"\n        showLevel := show_call_gex_5\n        lineColor := color_call_gex_5\n        lineStyleString := style_call_gex_5\n        lineWidth := width_call_gex_5\n    else if rank == \"Put GEX 1\"\n        showLevel := show_put_gex_1\n        lineColor := color_put_gex_1\n        lineStyleString := style_put_gex_1\n        lineWidth := width_put_gex_1\n    else if rank == \"Put GEX 2\"\n        showLevel := show_put_gex_2\n        lineColor := color_put_gex_2\n        lineStyleString := style_put_gex_2\n        lineWidth := width_put_gex_2\n    else if rank == \"Put GEX 3\"\n        showLevel := show_put_gex_3\n        lineColor := color_put_gex_3\n        lineStyleString := style_put_gex_3\n        lineWidth := width_put_gex_3\n    else if rank == \"Put GEX 4\"\n        showLevel := show_put_gex_4\n        lineColor := color_put_gex_4\n        lineStyleString := style_put_gex_4\n        lineWidth := width_put_gex_4\n    else if rank == \"Put GEX 5\"\n        showLevel := show_put_gex_5\n        lineColor := color_put_gex_5\n        lineStyleString := style_put_gex_5\n        lineWidth := width_put_gex_5\n    [showLevel, lineColor, lineStyleString, lineWidth]\n\n// ────────────────────────────────\n// PRE-ALLOCATE DRAWING OBJECTS\n// ────────────────────────────────\nvar array<line>  all_lines  = array.new_line()\nvar array<label> all_labels = array.new_label()\nif barstate.isfirst\n    for batch in all_batches\n        for _ in batch.levels\n            array.push(all_lines,  line.new(na, na, na, na, extend = extend.both))\n            array.push(all_labels, label.new(na, na))\n\n// ────────────────────────────────\n// MAIN //\n// ────────────────────────────────\nbatch_visibility = map.new<string, bool>()\nmap.put(batch_visibility, \"0DTE\",       show_0dte)\nmap.put(batch_visibility, \"1DTE\",       show_1dte)\nmap.put(batch_visibility, \"EoW\",        show_eow)\nmap.put(batch_visibility, \"EoM\",        show_eom)\nmap.put(batch_visibility, \"Next Week\",  show_nw)\nmap.put(batch_visibility, \"Next Month\", show_nm)\nmap.put(batch_visibility, \"Full\",       show_full)\n\n// Per-bar collections\npriceOwner      = map.new<int, int>()\npriceBestAbsVal = map.new<int, float>()\n\n// Buckets\npriceBucketIdx = map.new<int, int>()\nbuckets        = array.new<Bucket>()\n\n// Per-level arrays\na_show      = array.new<bool>()\na_pxTicks   = array.new<int>()\na_pxPrice   = array.new<float>()\na_lineCol   = array.new<color>()\na_styleStr  = array.new<string>()\na_lineW     = array.new<int>()\na_value     = array.new<float>()\na_rank      = array.new<string>()\na_batchName = array.new<string>()\na_batchClr  = array.new<color>()\n\n// Phase 1: collect + assign line owners + fill buckets\nfor batch in all_batches\n    is_batch_visible = map.contains(batch_visibility, batch.name) ? map.get(batch_visibility, batch.name) : false\n    for level_data in batch.levels\n        [showLevel, lnCol, stStr, lnW] = f_rankSettings(level_data.rank)\n\n        priceTicks = f_priceToTicks(level_data.price)\n        px         = f_ticksToPrice(priceTicks)\n\n        array.push(a_show, showLevel and is_batch_visible)\n        array.push(a_pxTicks, priceTicks)\n        array.push(a_pxPrice, px)\n        array.push(a_lineCol, lnCol)\n        array.push(a_styleStr, stStr)\n        array.push(a_lineW, lnW)\n        array.push(a_value, level_data.value)\n        array.push(a_rank, level_data.rank)\n        array.push(a_batchName, batch.name)\n        array.push(a_batchClr, batch.clr)\n\n        if showLevel and is_batch_visible\n            // ensure a bucket exists for this price\n            int bIdx = na\n            if map.contains(priceBucketIdx, priceTicks)\n                bIdx := map.get(priceBucketIdx, priceTicks)\n            else\n                newB = Bucket.new(array.new_float(), array.new_float())\n                array.push(buckets, newB)\n                bIdx := array.size(buckets) - 1\n                map.put(priceBucketIdx, priceTicks, bIdx)\n\n            // push value into bucket\n            b = array.get(buckets, bIdx)\n            array.push(b.values, level_data.value)\n\n            // choose owner by highest absolute value\n            bestAbs = map.contains(priceBestAbsVal, priceTicks) ? map.get(priceBestAbsVal, priceTicks) : na\n            curAbs  = math.abs(level_data.value)\n            curIdx  = array.size(a_show) - 1\n            if na(bestAbs) or curAbs > bestAbs\n                map.put(priceBestAbsVal, priceTicks, curAbs)\n                map.put(priceOwner,      priceTicks, curIdx)\n\n// Build sorted copies (descending) for each bucket\nfor i = 0 to array.size(buckets) - 1\n    b = array.get(buckets, i)\n    array.clear(b.sorted)\n    tmp = array.copy(b.values)\n    array.sort(tmp, order.descending)\n    for k = 0 to array.size(tmp) - 1\n        array.push(b.sorted, array.get(tmp, k))\n\n// Phase 2: draw lines + labels (stacked below by descending value)\nfor idx = 0 to array.size(a_show) - 1\n    line ln  = array.get(all_lines,  idx)\n    label lb = array.get(all_labels, idx)\n\n    // hide until used this bar\n    ln.set_xy1(na, na)\n    ln.set_xy2(na, na)\n    lb.set_xy(na, na)\n\n    if array.get(a_show, idx)\n        pxTicks = array.get(a_pxTicks, idx)\n        px      = array.get(a_pxPrice, idx)\n\n        // Draw the line only for the \"owner\" at that price (highest abs value)\n        ownerIdx = map.contains(priceOwner, pxTicks) ? map.get(priceOwner, pxTicks) : na\n        if not na(ownerIdx) and idx == ownerIdx\n            ln.set_xy1(bar_index - 1, px)\n            ln.set_xy2(bar_index,     px)\n            ln.set_color(array.get(a_lineCol, idx))\n            ln.set_style(f_getLineStyle(array.get(a_styleStr, idx)))\n            ln.set_width(array.get(a_lineW, idx))\n\n        // Labels below the line, ordered by descending raw value\n        bIdx = map.get(priceBucketIdx, pxTicks)\n        b    = array.get(buckets, bIdx)\n        myV  = array.get(a_value, idx)\n        pos  = array.indexof(b.sorted, myV)  // 0 = highest value\n\n        ticksPerStep = 4\n        tickSize     = syminfo.mintick > 0 ? syminfo.mintick : 0.25\n        yOffset      = - (pos + 1) * ticksPerStep * tickSize\n        float labelY = px + yOffset\n\n        // Anchor to the right side\n        int xBase = anchor_from_last ? last_bar_index : bar_index\n        lb.set_xy(xBase + right_shift_bars, labelY)\n        lb.set_text(array.get(a_rank, idx))\n        lb.set_color(color.new(array.get(a_batchClr, idx), 20))\n        lb.set_textcolor(color.white)\n        // Make the label extend to the right of the anchor (away from candles)\n        lb.set_style(extend_right ? label.style_label_left : label.style_label_right)\n\n        tip = \"Batch: \" + array.get(a_batchName, idx) +\n             \"\\nRank: \" + array.get(a_rank, idx) +\n             \"\\nTheo ES: \" + str.tostring(px) +\n             \"\\nValue: \"  + str.tostring(myV)\n        lb.set_tooltip(tip)\n";

  const PINESCRIPT_BUCKETS = [
    {
      key: "0dte",
      label: "0DTE",
      prefix: "0dte"
    },
    {
      key: "1dte",
      label: "1DTE",
      prefix: "1dte"
    },
    {
      key: "EoW",
      label: "EoW",
      prefix: "eow"
    },
    {
      key: "EoM",
      label: "EoM",
      prefix: "eom"
    },
    {
      key: "nex_EoW",
      label: "Next Week",
      prefix: "nw"
    },
    {
      key: "nex_EoM",
      label: "Next Month",
      prefix: "nm"
    },
    {
      key: "Full",
      label: "Full",
      prefix: "full"
    }
  ];

  const PINESCRIPT_RANKS = [
    { rank: "Call GEX 1", side: "Call", number: 1, suffix: "c1" },
    { rank: "Call GEX 2", side: "Call", number: 2, suffix: "c2" },
    { rank: "Call GEX 3", side: "Call", number: 3, suffix: "c3" },
    { rank: "Call GEX 4", side: "Call", number: 4, suffix: "c4" },
    { rank: "Call GEX 5", side: "Call", number: 5, suffix: "c5" },
    { rank: "Put GEX 1", side: "Put", number: 1, suffix: "p1" },
    { rank: "Put GEX 2", side: "Put", number: 2, suffix: "p2" },
    { rank: "Put GEX 3", side: "Put", number: 3, suffix: "p3" },
    { rank: "Put GEX 4", side: "Put", number: 4, suffix: "p4" },
    { rank: "Put GEX 5", side: "Put", number: 5, suffix: "p5" }
  ];

  const PINESCRIPT_RANK_MAP = new Map(
    PINESCRIPT_RANKS.map((item, index) => [
      item.rank,
      { ...item, order: index }
    ])
  );

  function pinescriptNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : "0.00";
  }

  function pinescriptSafeText(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
  }

  function pineGenerationTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");

    return (
      `${now.getFullYear()}-` +
      `${pad(now.getMonth() + 1)}-` +
      `${pad(now.getDate())} ` +
      `${pad(now.getHours())}:` +
      `${pad(now.getMinutes())}:` +
      `${pad(now.getSeconds())}`
    );
  }

  function latestTimestampFromRows(rows) {
    return rows
      .map((row) => row.timestamp)
      .filter(Boolean)
      .map(String)
      .sort()
      .at(-1) || null;
  }

  function normalizePinescriptBucket(rows, bucket) {
    const timestamp = latestTimestampFromRows(rows);

    if (!timestamp) {
      throw new Error("No valid timestamp found.");
    }

    const latestGexRows = rows
      .filter((row) =>
        String(row.timestamp) === timestamp &&
        String(row.Greek || "").toUpperCase() === "GEX" &&
        PINESCRIPT_RANK_MAP.has(String(row.Rank)) &&
        Number.isFinite(Number(row["Theo ES"])) &&
        Number.isFinite(Number(row.Value))
      )
      .map((row) => {
        const rankMeta = PINESCRIPT_RANK_MAP.get(String(row.Rank));

        return {
          bucketKey: bucket.key,
          bucketLabel: bucket.label,
          bucketPrefix: bucket.prefix,
          timestamp,
          rank: String(row.Rank),
          rankOrder: rankMeta.order,
          rankSuffix: rankMeta.suffix,
          side: rankMeta.side,
          rankNumber: rankMeta.number,
          theoES: Number(row["Theo ES"]),
          strikePrice: Number(row.strikePrice),
          value: Number(row.Value)
        };
      })
      .sort((a, b) => a.rankOrder - b.rankOrder);

    // Keep the final row for a duplicated rank at the same timestamp.
    const byRank = new Map();
    latestGexRows.forEach((level) => byRank.set(level.rank, level));

    const levels = PINESCRIPT_RANKS
      .map((rankMeta) => byRank.get(rankMeta.rank))
      .filter(Boolean);

    return {
      bucket,
      timestamp,
      levels,
      missingRanks: PINESCRIPT_RANKS
        .map((rankMeta) => rankMeta.rank)
        .filter((rank) => !byRank.has(rank))
    };
  }

  function buildPineDataBlock(snapshot) {
    const lines = [];

    for (const bucket of PINESCRIPT_BUCKETS) {
      const result = snapshot.bucketResults.find(
        (item) => item.ok && item.bucket.key === bucket.key
      );

      if (!result) {
        throw new Error(`${bucket.label} data is unavailable.`);
      }

      const byRank = new Map(
        result.data.levels.map((level) => [level.rank, level])
      );

      for (const rankMeta of PINESCRIPT_RANKS) {
        const level = byRank.get(rankMeta.rank);

        if (!level) {
          throw new Error(
            `${bucket.label} is missing ${rankMeta.rank} at ${result.data.timestamp}.`
          );
        }

        lines.push(
          `var gex_${bucket.prefix}_${rankMeta.suffix} = ` +
          `GexLevel.new(${pinescriptNumber(level.theoES)}, ` +
          `"${pinescriptSafeText(level.rank)}", ` +
          `${pinescriptNumber(level.value)})`
        );
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  const THINKSCRIPT_BUCKETS = [
    {
      key: "0dte",
      label: "0DTE",
      prefix: "d0",
      showInput: "show0DTE",
      colorName: "Bucket0DTE",
      color: [207, 238, 219]
    },
    {
      key: "1dte",
      label: "1DTE",
      prefix: "d1",
      showInput: "show1DTE",
      colorName: "Bucket1DTE",
      color: [255, 246, 201]
    },
    {
      key: "EoW",
      label: "EoW",
      prefix: "eow",
      showInput: "showEOW",
      colorName: "BucketEOW",
      color: [255, 167, 38]
    },
    {
      key: "EoM",
      label: "EoM",
      prefix: "eom",
      showInput: "showEOM",
      colorName: "BucketEOM",
      color: [255, 82, 82]
    },
    {
      key: "nex_EoW",
      label: "Next Week",
      prefix: "nw",
      showInput: "showNextWeek",
      colorName: "BucketNextWeek",
      color: [255, 246, 201]
    },
    {
      key: "nex_EoM",
      label: "Next Month",
      prefix: "nm",
      showInput: "showNextMonth",
      colorName: "BucketNextMonth",
      color: [255, 183, 77]
    },
    {
      key: "Full",
      label: "Full",
      prefix: "full",
      showInput: "showFull",
      colorName: "BucketFull",
      color: [161, 39, 42]
    }
  ];

  const THINKSCRIPT_RANKS = [
    { rank: "Call GEX 1", suffix: "c1", showInput: "showCallGEX1", colorName: "Call1", color: [139, 30, 44] },
    { rank: "Call GEX 2", suffix: "c2", showInput: "showCallGEX2", colorName: "Call2", color: [178, 34, 52] },
    { rank: "Call GEX 3", suffix: "c3", showInput: "showCallGEX3", colorName: "Call3", color: [224, 85, 98] },
    { rank: "Call GEX 4", suffix: "c4", showInput: "showCallGEX4", colorName: "Call4", color: [242, 138, 147] },
    { rank: "Call GEX 5", suffix: "c5", showInput: "showCallGEX5", colorName: "Call5", color: [248, 184, 190] },
    { rank: "Put GEX 1", suffix: "p1", showInput: "showPutGEX1", colorName: "Put1", color: [14, 64, 46] },
    { rank: "Put GEX 2", suffix: "p2", showInput: "showPutGEX2", colorName: "Put2", color: [30, 111, 58] },
    { rank: "Put GEX 3", suffix: "p3", showInput: "showPutGEX3", colorName: "Put3", color: [46, 139, 87] },
    { rank: "Put GEX 4", suffix: "p4", showInput: "showPutGEX4", colorName: "Put4", color: [126, 207, 138] },
    { rank: "Put GEX 5", suffix: "p5", showInput: "showPutGEX5", colorName: "Put5", color: [207, 238, 214] }
  ];

  const THINKSCRIPT_BUCKET_MAP = new Map(
    THINKSCRIPT_BUCKETS.map((item) => [item.key, item])
  );

  const THINKSCRIPT_RANK_MAP = new Map(
    THINKSCRIPT_RANKS.map((item) => [item.rank, item])
  );

  function validateGeneratorSnapshot(snapshot) {
    const problems = [];

    for (const bucket of PINESCRIPT_BUCKETS) {
      const result = snapshot.bucketResults.find(
        (item) => item.bucket.key === bucket.key
      );

      if (!result?.ok) {
        problems.push(
          `${bucket.label}: ${result?.message || "file unavailable"}`
        );
        continue;
      }

      if (result.data.levels.length !== 10) {
        problems.push(
          `${bucket.label}: expected 10 GEX ranks, found ${result.data.levels.length}`
        );
      }

      if (result.data.missingRanks.length) {
        problems.push(
          `${bucket.label} missing ${result.data.missingRanks.join(", ")}`
        );
      }
    }

    return problems;
  }

  function validatePinescriptSnapshot(snapshot) {
    return validateGeneratorSnapshot(snapshot);
  }

  function buildPinescriptSource(snapshot) {
    const problems = validateGeneratorSnapshot(snapshot);

    if (problems.length) {
      throw new Error(
        "Pine Script was not created because the latest snapshot is incomplete: " +
        problems.join(" | ")
      );
    }

    const dataBlock = buildPineDataBlock(snapshot);
    const generationDate = pineGenerationTimestamp();

    return PINE_SCRIPT_TEMPLATE
      .replace("{generation_date}", generationDate)
      .replace("{gex_data_block}", dataBlock);
  }

  function thinkscriptNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : "0.00";
  }

  function thinkscriptSafeText(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
  }

  function enrichThinkscriptLevels(snapshot) {
    return snapshot.levels.map((level) => {
      const bucketMeta = THINKSCRIPT_BUCKET_MAP.get(level.bucketKey);
      const rankMeta = THINKSCRIPT_RANK_MAP.get(level.rank);

      if (!bucketMeta || !rankMeta) {
        throw new Error(
          `ThinkScript mapping is missing for ${level.bucketLabel} / ${level.rank}.`
        );
      }

      return {
        ...level,
        tsBucketPrefix: bucketMeta.prefix,
        tsBucketShowInput: bucketMeta.showInput,
        tsBucketColorName: bucketMeta.colorName,
        tsRankSuffix: rankMeta.suffix,
        tsRankShowInput: rankMeta.showInput,
        tsRankColorName: rankMeta.colorName
      };
    });
  }

  function groupThinkscriptLevelsByPrice(levels) {
    const groups = new Map();

    levels.forEach((level) => {
      const price = thinkscriptNumber(level.theoES);

      if (!groups.has(price)) {
        groups.set(price, []);
      }

      groups.get(price).push({
        ...level,
        generatedPrice: price
      });
    });

    return [...groups.entries()]
      .map(([price, members]) => {
        // Same ownership rule that was tested successfully in v1.1:
        // the highest absolute GEX Value owns the horizontal line.
        const ownerOrder = [...members].sort(
          (a, b) => Math.abs(b.value) - Math.abs(a.value)
        );

        // Labels sharing a Theo ES level are stacked by descending raw Value.
        const labelOrder = [...members].sort(
          (a, b) => b.value - a.value
        );

        const labelOffset = new Map(
          labelOrder.map((level, index) => [
            `${level.tsBucketPrefix}_${level.tsRankSuffix}`,
            index + 1
          ])
        );

        return {
          price,
          members,
          ownerOrder,
          labelOffset
        };
      })
      .sort((a, b) => Number(a.price) - Number(b.price));
  }

  function buildThinkscriptSource(snapshot) {
    const problems = validateGeneratorSnapshot(snapshot);

    if (problems.length) {
      throw new Error(
        "ThinkScript was not created because the latest snapshot is incomplete: " +
        problems.join(" | ")
      );
    }

    const levels = enrichThinkscriptLevels(snapshot);
    const groups = groupThinkscriptLevelsByPrice(levels);
    const output = [];

    output.push(
      "# ================================================================",
      "# CBCharts GEX Levels for ES",
      `# Pusherman folder: ${snapshot.folder}`,
      "# Source rule: newest timestamp per bucket, Greek == GEX",
      "# Price used on ES chart: Theo ES",
      "# Platform: Thinkorswim / ThinkScript",
      "# Generated manually from CBChartsDashboard",
      `# Generated: ${new Date().toLocaleString()}`,
      "# ================================================================",
      "",
      "declare upper;",
      "",
      "# -------------------------------",
      "# DISPLAY INPUTS",
      "# -------------------------------",
      "input showLabels = yes;",
      "input labelOffsetTicks = 4;",
      "input showHeaderLabel = yes;",
      ""
    );

    THINKSCRIPT_BUCKETS.forEach((bucket) => {
      output.push(`input ${bucket.showInput} = yes;`);
    });

    output.push("");

    THINKSCRIPT_RANKS.forEach((rank) => {
      output.push(`input ${rank.showInput} = yes;`);
    });

    output.push(
      "",
      "# -------------------------------",
      "# GLOBAL COLORS",
      "# -------------------------------"
    );

    THINKSCRIPT_RANKS.forEach((rank) => {
      output.push(
        `DefineGlobalColor("${rank.colorName}", CreateColor(${rank.color.join(", ")}));`
      );
    });

    output.push("");

    THINKSCRIPT_BUCKETS.forEach((bucket) => {
      output.push(
        `DefineGlobalColor("${bucket.colorName}", CreateColor(${bucket.color.join(", ")}));`
      );
    });

    output.push(
      "",
      "# -------------------------------",
      "# SNAPSHOT METADATA",
      "# -------------------------------",
      `AddLabel(showHeaderLabel, "CBCharts GEX | ${snapshot.folder}", Color.LIGHT_GRAY);`
    );

    snapshot.bucketResults.forEach((result) => {
      if (!result.ok) return;

      const bucketMeta = THINKSCRIPT_BUCKET_MAP.get(result.bucket.key);

      output.push(
        `AddLabel(showHeaderLabel and ${bucketMeta.showInput}, ` +
        `"${thinkscriptSafeText(bucketMeta.label)} | ${thinkscriptSafeText(result.data.timestamp)}", ` +
        `GlobalColor("${bucketMeta.colorName}"));`
      );
    });

    output.push(
      "",
      "# -------------------------------",
      "# HARDCODED GEX DATA",
      "# -------------------------------",
      "def cbLastBar = !IsNaN(close) and IsNaN(close[-1]);",
      "def cbLabelStep = labelOffsetTicks * TickSize();",
      ""
    );

    levels.forEach((level) => {
      const id = `${level.tsBucketPrefix}_${level.tsRankSuffix}`;

      output.push(
        `# ${level.bucketLabel} | ${level.rank} | ${level.timestamp}`,
        `def px_${id} = ${thinkscriptNumber(level.theoES)};`,
        `def val_${id} = ${thinkscriptNumber(level.value)};`,
        `def vis_${id} = ${level.tsBucketShowInput} and ${level.tsRankShowInput};`,
        ""
      );
    });

    output.push(
      "# -------------------------------",
      "# PRICE-DEDUPED HORIZONTAL LEVELS",
      "# -------------------------------"
    );

    groups.forEach((group, index) => {
      const plotName = `GEX_Level_${String(index + 1).padStart(3, "0")}`;

      const visibility = group.ownerOrder
        .map((level) =>
          `vis_${level.tsBucketPrefix}_${level.tsRankSuffix}`
        )
        .join(" or ");

      const colorExpression = group.ownerOrder
        .map((level) =>
          `if vis_${level.tsBucketPrefix}_${level.tsRankSuffix} ` +
          `then GlobalColor("${level.tsRankColorName}")`
        )
        .join(" else ");

      output.push(
        `# Theo ES ${group.price} | ${group.members.length} source level${group.members.length === 1 ? "" : "s"}`,
        `plot ${plotName} = if ${visibility} then ${group.price} else Double.NaN;`,
        `${plotName}.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);`,
        `${plotName}.SetLineWeight(2);`,
        `${plotName}.SetDefaultColor(Color.GRAY);`,
        `${plotName}.AssignValueColor(${colorExpression} else Color.GRAY);`,
        `${plotName}.HideTitle();`,
        `${plotName}.HideBubble();`,
        ""
      );
    });

    output.push(
      "# -------------------------------",
      "# LEVEL LABELS",
      "# -------------------------------"
    );

    groups.forEach((group) => {
      group.members.forEach((level) => {
        const id = `${level.tsBucketPrefix}_${level.tsRankSuffix}`;
        const offset = group.labelOffset.get(id) || 1;
        const labelText =
          `${thinkscriptSafeText(level.bucketLabel)} | ` +
          `${thinkscriptSafeText(level.rank)}`;

        output.push(
          "AddChartBubble(",
          `    showLabels and cbLastBar and vis_${id},`,
          `    px_${id} - (${offset} * cbLabelStep),`,
          `    "${labelText}",`,
          `    GlobalColor("${level.tsBucketColorName}"),`,
          "    no",
          ");"
        );
      });
    });

    output.push(
      "",
      "# ================================================================",
      "# END CBCharts GENERATED GEX LEVELS",
      "# ================================================================"
    );

    return output.join("\n");
  }

  function clearGeneratorDisplay(scriptType) {
    clearError("pinescriptError");

    state.generatedScriptType = null;
    state.generatedScriptFolder = null;

    $("pinescriptOutput").value = "";
    $("copyGeneratedScript").disabled = true;
    $("downloadGeneratedScript").disabled = true;

    $("pinescriptFolder").textContent = "—";
    $("pinescriptBucketCount").textContent = "—";
    $("pinescriptLevelCount").textContent = "—";

    $("scriptPlatformValue").textContent =
      scriptType === "thinkscript"
        ? "Thinkorswim · Theo ES"
        : "TradingView · Theo ES";

    $("generatedScriptBadge").textContent =
      scriptType === "thinkscript"
        ? "Generating ThinkScript…"
        : "Generating Pine Script…";

    $("pinescriptBucketTable").innerHTML = `
      <tr class="pinescript-placeholder-row">
        <td colspan="4">Loading the latest Pusherman3000 snapshot…</td>
      </tr>
    `;

    document.querySelectorAll(".generator-platform-button").forEach((button) => {
      button.classList.toggle(
        "active-platform",
        button.dataset.scriptType === scriptType
      );
    });
  }

  function renderPinescriptSnapshot(snapshot) {
    const folder = snapshot?.folder || "—";
    const successful =
      snapshot?.bucketResults?.filter((result) => result.ok) || [];
    const totalLevels = snapshot?.levels?.length || 0;

    $("pinescriptFolder").textContent = folder;
    $("pinescriptBucketCount").textContent =
      `${successful.length}/${PINESCRIPT_BUCKETS.length}`;
    $("pinescriptLevelCount").textContent = String(totalLevels);

    const table = $("pinescriptBucketTable");

    if (!snapshot?.bucketResults?.length) {
      table.innerHTML = `
        <tr class="pinescript-placeholder-row">
          <td colspan="4">Choose a script type above to load the latest data.</td>
        </tr>
      `;
      return;
    }

    table.innerHTML = snapshot.bucketResults.map((result) => {
      if (!result.ok) {
        return `
          <tr class="pinescript-row-error">
            <td>${result.bucket.label}</td>
            <td>Unavailable</td>
            <td>0/10</td>
            <td>${result.message}</td>
          </tr>
        `;
      }

      const missing = result.data.missingRanks.length;
      const status = missing
        ? `Missing: ${result.data.missingRanks.join(", ")}`
        : "Ready";

      return `
        <tr class="${missing ? "pinescript-row-warning" : ""}">
          <td>${result.bucket.label}</td>
          <td>${result.data.timestamp}</td>
          <td>${result.data.levels.length}/10</td>
          <td>${status}</td>
        </tr>
      `;
    }).join("");
  }

  async function fetchGeneratorSnapshot() {
    const folders = await getLatestPushermanFolders(true);
    const folder = folders[0];

    if (!folder) {
      throw new Error(
        "Could not determine the newest pusherman3000 folder."
      );
    }

    $("pinescriptStatus").textContent =
      `Loading ${PINESCRIPT_BUCKETS.length} bucket files from ${folder}…`;

    const results = await Promise.all(
      PINESCRIPT_BUCKETS.map(async (bucket) => {
        const fileName = C.buckets[bucket.key]?.pusherman;

        if (!fileName) {
          return {
            ok: false,
            bucket,
            message: "No pusherman filename is configured."
          };
        }

        const path = `${folder}/brent_bs/${fileName}`;

        try {
          // Still manual only. Favor correctness over bandwidth:
          // load the full file, find its newest timestamp, then keep GEX.
          const text = await fetchText(raw("pusherman3000", path));
          const rows = parseCSV(text);
          const data = normalizePinescriptBucket(rows, bucket);

          return {
            ok: true,
            bucket,
            fileName,
            data
          };
        } catch (error) {
          return {
            ok: false,
            bucket,
            fileName,
            message: error.message
          };
        }
      })
    );

    const levels = results
      .filter((result) => result.ok)
      .flatMap((result) => result.data.levels);

    return {
      folder,
      bucketResults: results,
      levels
    };
  }

  async function generateScript(scriptType) {
    const isThinkscript = scriptType === "thinkscript";
    const pineButton = $("generatePinescript");
    const thinkButton = $("generateThinkscript");
    let snapshot = null;

    clearGeneratorDisplay(scriptType);

    pineButton.disabled = true;
    thinkButton.disabled = true;

    if (isThinkscript) {
      thinkButton.textContent = "Generating…";
    } else {
      pineButton.textContent = "Generating…";
    }

    $("pinescriptStatus").textContent =
      "Finding latest pusherman3000 folder…";

    try {
      snapshot = await fetchGeneratorSnapshot();
      renderPinescriptSnapshot(snapshot);

      const source = isThinkscript
        ? buildThinkscriptSource(snapshot)
        : buildPinescriptSource(snapshot);

      // One shared output area. Generating either platform replaces the
      // previously displayed script, so only the selected script is visible.
      $("pinescriptOutput").value = source;

      state.generatedScriptType =
        isThinkscript ? "thinkscript" : "pinescript";
      state.generatedScriptFolder = snapshot.folder;

      $("generatedScriptBadge").textContent =
        isThinkscript
          ? "Thinkorswim · ThinkScript"
          : "TradingView · Pine Script v6";

      $("pinescriptStatus").textContent =
        `Generated ${isThinkscript ? "ThinkScript" : "Pine Script v6"} ` +
        `from ${snapshot.folder} · ${snapshot.levels.length} GEX levels`;

      $("copyGeneratedScript").disabled = false;
      $("downloadGeneratedScript").disabled = false;

      $("downloadGeneratedScript").textContent =
        isThinkscript ? "Download .txt" : "Download .pine";
    } catch (error) {
      $("pinescriptOutput").value = "";
      state.generatedScriptType = null;
      state.generatedScriptFolder = null;

      if (!snapshot) {
        renderPinescriptSnapshot(null);
      }

      $("generatedScriptBadge").textContent = "Generation failed";
      $("pinescriptStatus").textContent = "Generation failed";

      showError(
        "pinescriptError",
        `Could not generate ${isThinkscript ? "ThinkScript" : "Pine Script"}: ${error.message}`
      );
    } finally {
      pineButton.disabled = false;
      thinkButton.disabled = false;
      pineButton.textContent = "Generate Pine Script";
      thinkButton.textContent = "Generate ThinkScript";
    }
  }

  function downloadGeneratedScript() {
    const text = $("pinescriptOutput").value;
    if (!text || !state.generatedScriptType) return;

    const folder = state.generatedScriptFolder || "latest";
    const isThinkscript = state.generatedScriptType === "thinkscript";
    const extension = isThinkscript ? "txt" : "pine";
    const platform = isThinkscript ? "Thinkorswim" : "TradingView";

    const blob = new Blob([text], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download =
      `CBCharts_GEX_ES_${platform}_${folder}.${extension}`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ---------------------------------------------------------------------------
  // NAVIGATION / REFRESH
  // ---------------------------------------------------------------------------

  function setView(view) {
    state.view = view;

    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    document.querySelectorAll(".view").forEach((section) => {
      section.classList.remove("active");
    });

    const target = $(`view-${view}`);
    if (!target) return;

    target.classList.add("active");

    // v1.5: SPX/Theo ES and the compact market controls remain visible
    // across every page.

    if (view === "overview") {
      renderSpotPrices();

      requestAnimationFrame(() => {
        ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
          resizePlotlyElement(`gauge-${metric}`);
        });
      });
    }

    if (view === "snapshot") {
      requestAnimationFrame(() => {
        for (let index = 1; index <= state.snapshotChartCount; index++) {
          resizePlotlyElement(`voltraChart${index}`);
        }

        for (let index = 1; index <= state.visualChartCount; index++) {
          resizeEmbeddedVisual(index);
        }
      });
    }

    if (view === "timelapse") {
      if (!state.history) {
        loadHistory();
      } else {
        requestAnimationFrame(() => {
          resizePlotlyElement("timelapseChart");
        });
      }
    }
  }

  async function refreshLive() {
    // All refresh entry points share one in-flight request set. This prevents
    // automatic refresh, manual refresh, and UI changes from creating duplicate
    // simultaneous GitHub request bursts.
    if (state.refreshPromise) {
      return state.refreshPromise;
    }

    state.refreshPromise = (async () => {
      await Promise.allSettled([
        loadGauges(),
        loadVoltra(),
        loadVisuals(),
        loadTheoEsBasis()
      ]);

      renderSpotPrices();

      if (state.voltra.length) {
        renderAllVoltra();
      }
    })();

    try {
      await state.refreshPromise;
    } finally {
      state.refreshPromise = null;
    }
  }

  async function focusChanged() {
    state.history = null;

    if (state.ratpack) {
      ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
        renderMetricGauge(metric, state.ratpack);
      });
    }

    await loadVisuals();

    if (state.view === "timelapse") {
      await loadHistory();
    }
  }

  function wireEvents() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    $("bucketSelect").addEventListener("change", async (event) => {
      state.bucket = event.target.value;
      state.history = null;
      state.theoEsBasis = null;
      renderSpotPrices();

      await Promise.allSettled([
        loadGauges(),
        loadVoltra(),
        loadTheoEsBasis()
      ]);

      if (state.view === "timelapse") {
        await loadHistory();
      }
    });

    $("greekSelect").addEventListener("change", async (event) => {
      state.greek = event.target.value;
      await focusChanged();
    });

    $("graphSizeSelect").addEventListener("change", (event) => {
      applyGraphSize(event.target.value);
    });

    $("strikeChartCount").addEventListener("change", (event) => {
      state.snapshotChartCount = Number(event.target.value) === 2 ? 2 : 1;
      updateSnapshotChartVisibility();
    });

    $("visualChartCount").addEventListener("change", async (event) => {
      state.visualChartCount = Number(event.target.value) === 1 ? 1 : 2;
      updateVisualChartVisibility();

      if (state.visualChartCount === 2) {
        await loadVisual(2);
      }
    });

    [1, 2].forEach((index) => {
      $(`snapshotMetric${index}`).addEventListener("change", (event) => {
        const chartState = snapshotChartState(index);
        const value = event.target.value;

        chartState.metric = value;

        if (value === "multi") {
          if (!chartState.multiMetrics.length) {
            chartState.multiMetrics = [chartState.lastSingleMetric];
          }

          document.querySelectorAll(
            `#multiMetricOptions${index} input[type="checkbox"]`
          ).forEach((input) => {
            input.checked = chartState.multiMetrics.includes(input.value);
          });
        } else {
          chartState.lastSingleMetric = value;
        }

        updateMultiMetricUI(index);
        renderVoltra(index);
      });

      $(`visualBucket${index}`).addEventListener("change", async (event) => {
        state.visualBuckets[index - 1] = event.target.value;

        if (index <= state.visualChartCount) {
          await loadVisual(index);
        }
      });
    });

    $("livePowerButton").addEventListener("click", (event) => {
      event.stopPropagation();

      // The power button starts live refresh. Once powered, clicking it again
      // simply reopens/closes the settings menu so users can change frequency
      // without accidentally shutting the feed off.
      if (!state.autoRefreshEnabled) {
        setAutoRefreshEnabled(true);
        toggleLivePowerMenu(true);
      } else {
        toggleLivePowerMenu();
      }
    });

    $("livePowerOffButton").addEventListener("click", () => {
      setAutoRefreshEnabled(false);
      toggleLivePowerMenu(false);
    });

    $("manualRefreshButton").addEventListener("click", async (event) => {
      event.stopPropagation();
      await runManualRefresh();
    });

    $("manualRefreshModalClose").addEventListener("click", () => {
      closeManualRefreshNotice();
    });

    $("manualRefreshModal").addEventListener("click", (event) => {
      if (event.target === $("manualRefreshModal")) {
        closeManualRefreshNotice();
      }
    });

    $("livePowerMenu").addEventListener("click", (event) => {
      event.stopPropagation();
    });

    $("refreshFrequencySelect").addEventListener("change", (event) => {
      const minutes = Number(event.target.value);

      if (![3, 5, 15, 30, 60].includes(minutes)) return;

      state.refreshMinutes = minutes;

      try {
        localStorage.setItem(
          "cbcharts-refresh-minutes",
          String(state.refreshMinutes)
        );
      } catch (_) {}

      if (state.autoRefreshEnabled) {
        scheduleAutoRefresh();
      }

      updateLivePowerUI();
    });

    document.addEventListener("click", () => {
      toggleLivePowerMenu(false);
    });

    document.querySelectorAll(".timelapse-mode-button").forEach((button) => {
      button.addEventListener("click", () => {
        stopPlayback();
        setTimelapseMode(button.dataset.mode);
      });
    });

    $("historyDate").addEventListener("change", loadHistory);

    $("historyDateNoticeClose").addEventListener("click", () => {
      closeHistoryDateNotice();
    });

    $("timelineSlider").addEventListener("input", (event) => {
      stopPlayback();
      updateFrame(event.target.value);
    });

    $("playButton").addEventListener("click", startPlayback);

    $("playbackSpeedSelect").addEventListener("change", (event) => {
      setPlaybackSpeed(event.target.value);
    });

    $("resetButton").addEventListener("click", () => {
      stopPlayback();
      state.playbackPassesCompleted = 0;
      $("playButton").removeAttribute("title");
      updateFrame(0);
    });

    $("generatePinescript").addEventListener("click", () => {
      generateScript("pinescript");
    });

    $("generateThinkscript").addEventListener("click", () => {
      generateScript("thinkscript");
    });

    $("copyGeneratedScript").addEventListener("click", async () => {
      const text = $("pinescriptOutput").value;
      if (!text) return;

      await navigator.clipboard.writeText(text);
      $("copyGeneratedScript").textContent = "Copied";

      setTimeout(() => {
        $("copyGeneratedScript").textContent = "Copy code";
      }, 1000);
    });

    $("downloadGeneratedScript").addEventListener(
      "click",
      downloadGeneratedScript
    );
  }

  async function init() {
    loadStoredGraphSize();
    initControls();
    buildGaugeCards();
    initializeSnapshotControls();
    initLivePowerControl();
    initManualRefreshControl();
    renderRepos();
    wireEvents();

    applyGraphSize(state.graphSize, false);
    renderSpotPrices();

    $("lastRefresh").textContent = "Loading latest data…";

    // Timelapse defaults dynamically to the newest Pusherman YYYYMMDD folder.
    await initializeLatestHistoryDate();

    // Startup behavior: load the newest data once, then stay static until
    // the user manually refreshes or powers on automatic live refresh.
    await refreshLive();

    updateLivePowerUI();
    updateManualRefreshUI();
  }

  init();
})();
