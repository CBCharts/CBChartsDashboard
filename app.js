(() => {
  "use strict";

  const C = window.CB_CONFIG;
  const GREEKS = ["GEX", "CEX", "DEX", "VEX"];
  const $ = (id) => document.getElementById(id);

  const state = {
    view: "snapshot",
    bucket: C.defaultBucket,
    greek: C.defaultGreek,
    ratpack: null,
    voltra: [],
    history: null,
    playTimer: null,
    frame: 0,
    lastSingleMetric: "volume",
    multiMetrics: ["volume"],
    graphSize: "standard",
    timelapseMode: "levels",
    playbackSpeed: 1,
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
    return GRAPH_SIZES[state.graphSize] || GRAPH_SIZES.standard;
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

  function resizeEmbeddedVisual() {
    const frame = $("visualFrame");
    if (!frame) return;

    const baseHeight = 650;
    const height = Math.round(baseHeight * graphScale());
    frame.style.minHeight = `${height}px`;
    frame.style.height = `${height}px`;

    const panel = frame.closest(".visual-panel");
    if (panel) {
      panel.style.minHeight = `${height + 60}px`;
    }

    const loading = $("visualLoading");
    if (loading) loading.style.minHeight = `${height}px`;

    try {
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument;
      if (!frameWindow || !frameDocument) return;

      frameWindow.dispatchEvent(new Event("resize"));

      const plots = frameDocument.querySelectorAll(".plotly-graph-div");
      plots.forEach((plot) => {
        if (frameWindow.Plotly?.Plots?.resize) {
          frameWindow.Plotly.Plots.resize(plot);
        }
      });
    } catch (_) {
      // srcdoc is normally same-origin; if a browser blocks access,
      // the iframe container itself still resizes.
    }
  }

  function applyGraphSize(value, persist = true) {
    state.graphSize = Object.hasOwn(GRAPH_SIZES, value)
      ? value
      : "standard";

    const select = $("graphSizeSelect");
    if (select) select.value = state.graphSize;

    if (persist) {
      try {
        localStorage.setItem("cbcharts-graph-size", state.graphSize);
      } catch (_) {}
    }

    // Voltra uses a row-dependent base height stored during render.
    const voltra = $("voltraChart");
    if (voltra) {
      const base = Number(voltra.dataset.baseHeight) || 650;
      voltra.style.height = `${Math.round(base * graphScale())}px`;
    }

    setElementGraphHeight("timelapseChart", 560);
    resizeEmbeddedVisual();

    resizePlotlyElement("voltraChart");
    resizePlotlyElement("timelapseChart");

    ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
      resizePlotlyElement(`gauge-${metric}`);
    });
  }

  function loadStoredGraphSize() {
    try {
      const stored = localStorage.getItem("cbcharts-graph-size");
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
        }

        .plotly-graph-div,
        .js-plotly-plot {
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

    if (Number.isFinite(spx) && Number.isFinite(basis)) {
      const theoSpot = spx + basis;

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
          return;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("No recent bucket CSV could be read.");
    } catch (error) {
      state.theoEsBasis = null;
      renderSpotPrices();
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

  function setConnection(ok, text) {
    const dot = $("connectionDot");
    dot.className = ok === true ? "online" : ok === false ? "error" : "";
    $("connectionText").textContent = text;
    $("lastRefresh").textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
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
      shape: "bullet",
      axis: {
        range: [0, bound],
        visible: metric === "Ratio",
        tickmode: metric === "Ratio" ? "array" : undefined,
        tickvals: metric === "Ratio" ? [0, 1, bound] : undefined,
        ticktext: metric === "Ratio"
          ? ["0", "1.0", formatNumber(bound)]
          : undefined,
        tickfont: metric === "Ratio"
          ? { size: 8, color: "#7f91a5" }
          : undefined
      },
      bgcolor: "rgba(255,255,255,.025)",
      borderwidth: 0,
      bar: {
        color: visual.color,
        thickness: 0.48
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
          l: 12,
          r: 12,
          t: metric === "Ratio" ? 5 : 2,
          b: metric === "Ratio" ? 10 : 6
        },
        height: metric === "Ratio" ? 50 : 42
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

  function selectedVoltraMetrics() {
    const mode = $("snapshotMetric").value;

    if (mode !== "multi") {
      return [mode];
    }

    const selected = [...document.querySelectorAll(
      '#multiMetricOptions input[type="checkbox"]:checked'
    )].map((input) => input.value);

    return selected.slice(0, 3);
  }

  function updateMultiMetricUI(message = "") {
    const isMulti = $("snapshotMetric").value === "multi";
    $("multiMetricPanel").classList.toggle("hidden", !isMulti);

    if (!isMulti) return;

    const selected = selectedVoltraMetrics();
    $("multiMetricCount").textContent =
      message || `${selected.length}/3 selected`;

    document.querySelectorAll(
      '#multiMetricOptions input[type="checkbox"]'
    ).forEach((input) => {
      input.disabled = !input.checked && selected.length >= 3;
      input.closest(".multi-metric-option")?.classList.toggle(
        "disabled",
        input.disabled
      );
    });
  }

  function initializeMultiMetricOptions() {
    const options = Object.entries(VOLTRA_METRICS).map(([key, spec]) => `
      <label class="multi-metric-option">
        <input type="checkbox" value="${key}">
        <span>${spec.shortLabel}</span>
      </label>
    `).join("");

    $("multiMetricOptions").innerHTML = options;

    document.querySelectorAll(
      '#multiMetricOptions input[type="checkbox"]'
    ).forEach((input) => {
      input.checked = state.multiMetrics.includes(input.value);

      input.addEventListener("change", () => {
        let selected = selectedVoltraMetrics();

        // Multi must always contain at least one metric.
        if (!selected.length) {
          input.checked = true;
          selected = [input.value];
          updateMultiMetricUI("At least 1 metric is required");
          return;
        }

        // Defensive cap even if disabled-state timing is bypassed.
        if (selected.length > 3) {
          input.checked = false;
          selected = selectedVoltraMetrics();
          updateMultiMetricUI("Maximum 3 metrics");
          return;
        }

        state.multiMetrics = selected;
        updateMultiMetricUI();
        renderVoltra();
      });
    });

    updateMultiMetricUI();
  }
  function renderVoltra() {
    const sourceRows = state.voltra.filter((row) =>
      row.timestamp &&
      Number.isFinite(Number(row.strikePrice))
    );

    if (!sourceRows.length) {
      Plotly.purge("voltraChart");
      showError(
        "voltraError",
        "The selected Voltra file does not contain usable strike data."
      );
      return;
    }

    clearError("voltraError");

    const selectedKeys = selectedVoltraMetrics();
    const specs = selectedKeys
      .map((key) => ({ key, ...metricSpec(key) }))
      .filter((spec) => spec.title);

    if (!specs.length) {
      Plotly.purge("voltraChart");
      showError("voltraError", "Select at least one bar metric.");
      return;
    }

    $("voltraTitle").textContent = specs.length === 1
      ? specs[0].title
      : specs.map((spec) => spec.shortLabel).join(" + ") + " by strike";

    // Snapshot = newest timestamp only.
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

    // A strike appears only when at least one selected metric has data.
    const activeRows = latestRows
      .filter((row) => specs.some((spec) => metricHasData(row, spec)))
      .sort((a, b) => Number(a.strikePrice) - Number(b.strikePrice));

    if (!activeRows.length) {
      Plotly.purge("voltraChart");
      showError(
        "voltraError",
        `No non-zero data is available for the selected metric(s) in ${C.buckets[state.bucket].label} at ${latestTimestamp}.`
      );
      return;
    }

    const strikes = activeRows.map((row) => Number(row.strikePrice));
    const theoValues = activeRows
      .map((row) => Number(row["Theo ES"]))
      .filter(Number.isFinite);

    // Every visible bar gets the same complete row-level hover payload.
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
      .map((strike, index) => strike - strikes[index])
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

    // Invisible secondary-axis trace:
    // keeps the Theo ES Y-axis active without drawing yellow dots/lines.
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

    let theoRange = strikeRange;

    if (theoValues.length) {
      const minTheo = Math.min(...theoValues);
      const maxTheo = Math.max(...theoValues);
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

    const baseChartHeight = Math.max(
      480,
      Math.min(1100, activeRows.length * 27 + 165)
    );

    setElementGraphHeight("voltraChart", baseChartHeight);

    Plotly.react(
      "voltraChart",
      traces,
      {
        ...baseLayout,
        barmode: metricCount > 1 ? "group" : "relative",
        bargap: metricCount > 1 ? 0.20 : 0.18,
        bargroupgap: metricCount > 1 ? 0.08 : 0,
        hovermode: "closest",
        margin: { l: 92, r: 95, t: 34, b: 56 },

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

        // LEFT: data-bearing strike prices only.
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

        // RIGHT: Theo ES remains a true secondary Y-axis, but uses clean
        // auto-ticks rather than one label for every row.
        yaxis2: {
          title: {
            text: "Theo ES",
            standoff: 8,
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
  async function loadVoltra() {
    clearError("voltraError");

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

      $("voltraTimestamp").textContent =
        timestamp ? `As of ${timestamp}` : "Latest";

      renderVoltra();
    } catch (error) {
      showError("voltraError", `Could not load Voltra: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // BRENT BS VISUALS
  // ---------------------------------------------------------------------------

  async function loadVisual() {
    clearError("visualError");

    const bucket = C.buckets[state.bucket];
    const file = `${bucket.visualPrefix}_brent_bs_${state.greek}.html`;

    $("visualTitle").textContent = `${bucket.label} ${state.greek}`;
    $("visualSourceLink").href =
      `https://github.com/CBCharts/BrentBSVisuals/blob/main/${file}`;

    $("visualLoading").classList.remove("hidden");
    $("visualFrame").classList.add("hidden");

    resizeEmbeddedVisual();

    try {
      const rawHtml = await fetchText(raw("BrentBSVisuals", file));

      const extractedSpxSpot = extractSpxSpotFromPlotlyHtml(rawHtml);

      if (Number.isFinite(extractedSpxSpot)) {
        state.spxSpot = extractedSpxSpot;
      } else {
        state.spxSpot = null;
      }

      renderSpotPrices();

      const responsiveHtml = makeEmbeddedPlotlyResponsive(rawHtml);

      $("visualFrame").onload = () => {
        $("visualLoading").classList.add("hidden");
        $("visualFrame").classList.remove("hidden");

        // Give Plotly a moment to complete its own initialization, then
        // resize the plot to the user-selected graph size.
        setTimeout(resizeEmbeddedVisual, 50);
        setTimeout(resizeEmbeddedVisual, 250);
      };

      $("visualFrame").srcdoc = responsiveHtml;
    } catch (error) {
      state.spxSpot = null;
      renderSpotPrices();

      $("visualLoading").classList.add("hidden");
      showError(
        "visualError",
        `Could not load BrentBSVisuals: ${error.message}`
      );
    }
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

  async function loadHistory() {
    stopPlayback();
    clearError("timelapseError");

    const date = ymd($("historyDate").value);
    $("timelineLabel").textContent = "Loading session…";

    try {
      const text = await fetchText(raw("pusherman3000", historicalPath(date), false));
      state.history = buildHistory(parseCSV(text));
      renderHistory(state.history);
    } catch (error) {
      state.history = null;
      $("timelineLabel").textContent = "Session unavailable";
      showError(
        "timelapseError",
        `Could not load ${date} ${C.buckets[state.bucket].label} ${state.greek}: ${error.message}`
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

    const next =
      state.frame >= state.history.frames.length - 1
        ? 0
        : state.frame + 1;

    updateFrame(next);
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

    $("playButton").textContent = "❚❚ Pause";
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
  // REPOS + THINKSCRIPT
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
    { rank: "Call GEX 1", side: "Call", number: 1, suffix: "c1", showInput: "showCallGEX1", colorName: "Call1", color: [139, 30, 44] },
    { rank: "Call GEX 2", side: "Call", number: 2, suffix: "c2", showInput: "showCallGEX2", colorName: "Call2", color: [178, 34, 52] },
    { rank: "Call GEX 3", side: "Call", number: 3, suffix: "c3", showInput: "showCallGEX3", colorName: "Call3", color: [224, 85, 98] },
    { rank: "Call GEX 4", side: "Call", number: 4, suffix: "c4", showInput: "showCallGEX4", colorName: "Call4", color: [242, 138, 147] },
    { rank: "Call GEX 5", side: "Call", number: 5, suffix: "c5", showInput: "showCallGEX5", colorName: "Call5", color: [248, 184, 190] },
    { rank: "Put GEX 1", side: "Put", number: 1, suffix: "p1", showInput: "showPutGEX1", colorName: "Put1", color: [14, 64, 46] },
    { rank: "Put GEX 2", side: "Put", number: 2, suffix: "p2", showInput: "showPutGEX2", colorName: "Put2", color: [30, 111, 58] },
    { rank: "Put GEX 3", side: "Put", number: 3, suffix: "p3", showInput: "showPutGEX3", colorName: "Put3", color: [46, 139, 87] },
    { rank: "Put GEX 4", side: "Put", number: 4, suffix: "p4", showInput: "showPutGEX4", colorName: "Put4", color: [126, 207, 138] },
    { rank: "Put GEX 5", side: "Put", number: 5, suffix: "p5", showInput: "showPutGEX5", colorName: "Put5", color: [207, 238, 214] }
  ];

  const THINKSCRIPT_RANK_MAP = new Map(
    THINKSCRIPT_RANKS.map((item, index) => [item.rank, { ...item, order: index }])
  );

  function thinkscriptNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : "0.00";
  }

  function thinkscriptSafeText(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
  }

  function latestTimestampFromRows(rows) {
    return rows
      .map((row) => row.timestamp)
      .filter(Boolean)
      .map(String)
      .sort()
      .at(-1) || null;
  }

  function normalizeThinkscriptBucket(rows, bucket) {
    const timestamp = latestTimestampFromRows(rows);

    if (!timestamp) {
      throw new Error("No valid timestamp found.");
    }

    const latestGexRows = rows
      .filter((row) =>
        String(row.timestamp) === timestamp &&
        String(row.Greek || "").toUpperCase() === "GEX" &&
        THINKSCRIPT_RANK_MAP.has(String(row.Rank)) &&
        Number.isFinite(Number(row["Theo ES"])) &&
        Number.isFinite(Number(row.Value))
      )
      .map((row) => {
        const rankMeta = THINKSCRIPT_RANK_MAP.get(String(row.Rank));

        return {
          bucketKey: bucket.key,
          bucketLabel: bucket.label,
          bucketPrefix: bucket.prefix,
          bucketShowInput: bucket.showInput,
          bucketColorName: bucket.colorName,
          timestamp,
          rank: String(row.Rank),
          rankOrder: rankMeta.order,
          rankSuffix: rankMeta.suffix,
          rankShowInput: rankMeta.showInput,
          rankColorName: rankMeta.colorName,
          side: rankMeta.side,
          rankNumber: rankMeta.number,
          theoES: Number(row["Theo ES"]),
          strikePrice: Number(row.strikePrice),
          value: Number(row.Value)
        };
      })
      .sort((a, b) => a.rankOrder - b.rankOrder);

    // If duplicate rows somehow exist for a rank at the same timestamp,
    // keep the last one so each bucket contributes at most 10 levels.
    const byRank = new Map();
    latestGexRows.forEach((level) => byRank.set(level.rank, level));

    const levels = THINKSCRIPT_RANKS
      .map((rankMeta) => byRank.get(rankMeta.rank))
      .filter(Boolean);

    return {
      bucket,
      timestamp,
      levels,
      missingRanks: THINKSCRIPT_RANKS
        .map((rankMeta) => rankMeta.rank)
        .filter((rank) => !byRank.has(rank))
    };
  }

  function groupThinkscriptLevelsByPrice(levels) {
    const groups = new Map();

    levels.forEach((level) => {
      // Match the old Python generator: hardcoded Theo ES levels are
      // generated to two decimals.
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
        // PineScript line-owner logic: highest absolute Value owns the line.
        const ownerOrder = [...members].sort(
          (a, b) => Math.abs(b.value) - Math.abs(a.value)
        );

        // PineScript label stacking uses raw Value descending.
        const labelOrder = [...members].sort(
          (a, b) => b.value - a.value
        );

        const labelOffset = new Map(
          labelOrder.map((level, index) => [
            `${level.bucketPrefix}_${level.rankSuffix}`,
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
    const { folder, bucketResults, levels } = snapshot;
    const groups = groupThinkscriptLevelsByPrice(levels);
    const output = [];

    output.push(
      "# ================================================================",
      "# CBCharts GEX Levels for ES",
      `# Pusherman folder: ${folder}`,
      "# Source rule: newest timestamp per bucket, Greek == GEX",
      "# Price used on ES chart: Theo ES",
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
      output.push(
        `input ${bucket.showInput} = yes;`
      );
    });

    output.push("");

    THINKSCRIPT_RANKS.forEach((rank) => {
      output.push(
        `input ${rank.showInput} = yes;`
      );
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
      `AddLabel(showHeaderLabel, "CBCharts GEX | ${folder}", Color.LIGHT_GRAY);`
    );

    bucketResults.forEach((result) => {
      if (!result.ok) return;

      output.push(
        `AddLabel(showHeaderLabel and ${result.bucket.showInput}, "${thinkscriptSafeText(result.bucket.label)} | ${thinkscriptSafeText(result.timestamp)}", GlobalColor("${result.bucket.colorName}"));`
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
      const id = `${level.bucketPrefix}_${level.rankSuffix}`;

      output.push(
        `# ${level.bucketLabel} | ${level.rank} | ${level.timestamp}`,
        `def px_${id} = ${thinkscriptNumber(level.theoES)};`,
        `def val_${id} = ${thinkscriptNumber(level.value)};`,
        `def vis_${id} = ${level.bucketShowInput} and ${level.rankShowInput};`,
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
        .map((level) => `vis_${level.bucketPrefix}_${level.rankSuffix}`)
        .join(" or ");

      const colorExpression = group.ownerOrder
        .map((level) =>
          `if vis_${level.bucketPrefix}_${level.rankSuffix} then GlobalColor("${level.rankColorName}")`
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
        const id = `${level.bucketPrefix}_${level.rankSuffix}`;
        const offset = group.labelOffset.get(id) || 1;
        const labelText =
          `${thinkscriptSafeText(level.bucketLabel)} | ` +
          `${thinkscriptSafeText(level.rank)}`;

        output.push(
          `AddChartBubble(`,
          `    showLabels and cbLastBar and vis_${id},`,
          `    px_${id} - (${offset} * cbLabelStep),`,
          `    "${labelText}",`,
          `    GlobalColor("${level.bucketColorName}"),`,
          `    no`,
          `);`
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

  function renderThinkscriptSnapshot(snapshot) {
    const folder = snapshot?.folder || "—";
    const successful = snapshot?.bucketResults?.filter((result) => result.ok) || [];
    const totalLevels = snapshot?.levels?.length || 0;

    $("thinkscriptFolder").textContent = folder;
    $("thinkscriptBucketCount").textContent =
      `${successful.length}/${THINKSCRIPT_BUCKETS.length}`;
    $("thinkscriptLevelCount").textContent = String(totalLevels);

    const table = $("thinkscriptBucketTable");

    if (!snapshot?.bucketResults?.length) {
      table.innerHTML = "";
      return;
    }

    table.innerHTML = snapshot.bucketResults.map((result) => {
      if (!result.ok) {
        return `
          <tr class="thinkscript-row-error">
            <td>${result.bucket.label}</td>
            <td>Unavailable</td>
            <td>0/10</td>
            <td>${result.message}</td>
          </tr>
        `;
      }

      const missing = result.data.missingRanks.length;
      const warning = missing
        ? `Missing: ${result.data.missingRanks.join(", ")}`
        : "Ready";

      return `
        <tr class="${missing ? "thinkscript-row-warning" : ""}">
          <td>${result.bucket.label}</td>
          <td>${result.data.timestamp}</td>
          <td>${result.data.levels.length}/10</td>
          <td>${warning}</td>
        </tr>
      `;
    }).join("");
  }

  async function fetchThinkscriptSnapshot() {
    const folders = await getLatestPushermanFolders(true);
    const folder = folders[0];

    if (!folder) {
      throw new Error("Could not determine the newest pusherman3000 folder.");
    }

    $("thinkscriptStatus").textContent =
      `Loading ${THINKSCRIPT_BUCKETS.length} bucket files from ${folder}…`;

    const results = await Promise.all(
      THINKSCRIPT_BUCKETS.map(async (bucket) => {
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
          // Manual generator: favor correctness over bandwidth optimization.
          // We fetch the complete CSV, explicitly select its newest timestamp,
          // and then keep GEX only.
          const text = await fetchText(raw("pusherman3000", path));
          const rows = parseCSV(text);
          const data = normalizeThinkscriptBucket(rows, bucket);

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

    if (!levels.length) {
      throw new Error(
        `No valid GEX levels were found in the latest folder (${folder}).`
      );
    }

    return {
      folder,
      bucketResults: results,
      levels
    };
  }

  async function generateThinkscript() {
    clearError("thinkscriptError");

    const button = $("generateThinkscript");
    button.disabled = true;
    button.textContent = "Generating…";
    $("copyThinkscript").disabled = true;
    $("downloadThinkscript").disabled = true;
    $("thinkscriptStatus").textContent = "Finding latest pusherman3000 folder…";

    try {
      const snapshot = await fetchThinkscriptSnapshot();
      const source = buildThinkscriptSource(snapshot);

      $("thinkscriptOutput").value = source;
      renderThinkscriptSnapshot(snapshot);

      const successful = snapshot.bucketResults.filter((result) => result.ok);
      const warnings = successful.reduce(
        (count, result) => count + result.data.missingRanks.length,
        0
      );

      $("thinkscriptStatus").textContent =
        `Generated ${snapshot.levels.length} GEX levels from ${snapshot.folder}` +
        (warnings ? ` · ${warnings} missing rank warning${warnings === 1 ? "" : "s"}` : "");

      $("copyThinkscript").disabled = false;
      $("downloadThinkscript").disabled = false;
      $("downloadThinkscript").dataset.folder = snapshot.folder;
    } catch (error) {
      $("thinkscriptOutput").value = "";
      renderThinkscriptSnapshot(null);
      $("thinkscriptStatus").textContent = "Generation failed";
      showError(
        "thinkscriptError",
        `Could not generate ThinkScript: ${error.message}`
      );
    } finally {
      button.disabled = false;
      button.textContent = "Generate ThinkScript";
    }
  }

  function downloadThinkscript() {
    const text = $("thinkscriptOutput").value;
    if (!text) return;

    const folder = $("downloadThinkscript").dataset.folder || "latest";
    const blob = new Blob([text], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `CBCharts_GEX_ES_${folder}.txt`;
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

    $(`view-${view}`).classList.add("active");

    $("pageTitle").textContent = {
      snapshot: "Snapshot",
      timelapse: "Timelapse",
      repos: "Repo's",
      thinkscript: "ThinkScript Generator",
      howto: "How-To"
    }[view];

    if (view === "timelapse" && !state.history) loadHistory();
  }

  async function refreshLive() {
    await Promise.allSettled([
      loadGauges(),
      loadVoltra(),
      loadVisual(),
      loadTheoEsBasis()
    ]);

    renderSpotPrices();
  }

  async function focusChanged() {
    state.history = null;

    // RatPack cards now depend on the selected Greek, so refresh the top strip too.
    if (state.ratpack) {
      ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
        renderMetricGauge(metric, state.ratpack);
      });
    }

    // SPX is extracted from the currently selected BrentBSVisuals HTML.
    await loadVisual();

    if (state.view === "timelapse") await loadHistory();
  }

  function wireEvents() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    $("bucketSelect").addEventListener("change", async (event) => {
      state.bucket = event.target.value;
      state.history = null;
      state.spxSpot = null;
      state.theoEsBasis = null;
      renderSpotPrices();

      await refreshLive();

      if (state.view === "timelapse") await loadHistory();
    });

    $("greekSelect").addEventListener("change", async (event) => {
      state.greek = event.target.value;
      await focusChanged();
    });

    $("refreshButton").addEventListener("click", async () => {
      await refreshLive();
      if (state.view === "timelapse") await loadHistory();
    });

    $("graphSizeSelect").addEventListener("change", (event) => {
      applyGraphSize(event.target.value);
    });

    $("snapshotMetric").addEventListener("change", (event) => {
      const value = event.target.value;

      if (value === "multi") {
        // Seed Multi with the last single metric if nothing is selected.
        if (!state.multiMetrics.length) {
          state.multiMetrics = [state.lastSingleMetric];
        }

        document.querySelectorAll(
          '#multiMetricOptions input[type="checkbox"]'
        ).forEach((input) => {
          input.checked = state.multiMetrics.includes(input.value);
        });
      } else {
        state.lastSingleMetric = value;
      }

      updateMultiMetricUI();
      renderVoltra();
    });
    document.querySelectorAll(".timelapse-mode-button").forEach((button) => {
      button.addEventListener("click", () => {
        stopPlayback();
        setTimelapseMode(button.dataset.mode);
      });
    });

    $("historyDate").addEventListener("change", loadHistory);

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
      updateFrame(0);
    });

    $("generateThinkscript").addEventListener("click", generateThinkscript);

    $("copyThinkscript").addEventListener("click", async () => {
      const text = $("thinkscriptOutput").value;
      if (!text) return;

      await navigator.clipboard.writeText(text);
      $("copyThinkscript").textContent = "Copied";
      setTimeout(() => {
        $("copyThinkscript").textContent = "Copy code";
      }, 1000);
    });

    $("downloadThinkscript").addEventListener("click", downloadThinkscript);
  }

  async function init() {
    loadStoredGraphSize();
    initControls();
    buildGaugeCards();
    initializeMultiMetricOptions();
    renderRepos();
    wireEvents();
    applyGraphSize(state.graphSize, false);
    renderSpotPrices();
    setConnection(null, "Connecting");

    await refreshLive();

    setInterval(() => {
      loadGauges();
      loadVoltra();
      loadTheoEsBasis();

      // SPX lives inside the Plotly HTML, so refresh that HTML each minute
      // even when another left-nav view is open. The iframe is only visible
      // on Snapshot, but the top spot cards remain current everywhere.
      loadVisual();
    }, C.refreshMs);
  }

  init();
})();
