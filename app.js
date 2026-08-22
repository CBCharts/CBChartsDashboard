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
    graphSize: "standard"
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

  function renderHistory(history) {
    if (!history.frames.length) throw new Error("No matching ranked rows found.");

    setElementGraphHeight("timelapseChart", 560);

    const callColors = ["#4ca7ff", "#67b6ff", "#82c4ff", "#9bd1ff", "#b4ddff"];
    const putColors = ["#ff626d", "#ff7a83", "#ff929b", "#ffabb1", "#ffc1c6"];

    const traces = history.keys.map((key, index) => ({
      type: "scatter",
      mode: "lines",
      name: key,
      x: history.frames.map((frame) => frame.timestamp),
      y: history.frames.map((frame) => frame.ranks[key]?.strike ?? null),
      connectgaps: false,
      line: {
        width: 1.7,
        color: key.startsWith("Call") ? callColors[index] : putColors[index - 5]
      },
      hovertemplate: `${key}<br>%{x}<br>Strike %{y:,.3~f}<extra></extra>`
    }));

    traces.push({
      type: "scatter",
      mode: "lines",
      name: "Theo ES",
      x: history.frames.map((frame) => frame.timestamp),
      y: history.frames.map((frame) => frame.theo),
      line: { color: "#f4b942", width: 2, dash: "dot" },
      hovertemplate: "Theo ES<br>%{x}<br>%{y:,.3~f}<extra></extra>"
    });

    traces.push({
      type: "scatter",
      mode: "markers+text",
      name: "Current",
      x: [],
      y: [],
      text: [],
      textposition: "middle right",
      textfont: { size: 9, color: "#eef4fb" },
      marker: {
        size: 8,
        color: history.keys.map((key) =>
          key.startsWith("Call") ? "#49a5ff" : "#ff6670"
        )
      },
      showlegend: false
    });

    Plotly.react(
      "timelapseChart",
      traces,
      {
        ...baseLayout,
        hovermode: "x unified",
        margin: { l: 64, r: 72, t: 30, b: 55 },
        xaxis: {
          ...baseLayout.xaxis,
          title: { text: "Time" }
        },
        yaxis: {
          ...baseLayout.yaxis,
          title: { text: "Strike level" },
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

    $("timelineSlider").max = String(history.frames.length - 1);
    $("timelineSlider").value = "0";
    state.frame = 0;
    updateFrame(0);
  }

  function updateFrame(index) {
    if (!state.history?.frames.length) return;

    const safeIndex = Math.max(
      0,
      Math.min(Number(index) || 0, state.history.frames.length - 1)
    );

    state.frame = safeIndex;
    const frame = state.history.frames[safeIndex];
    const markerX = [];
    const markerY = [];
    const markerText = [];

    $("timelineSlider").value = String(safeIndex);
    $("timelineLabel").textContent = frame.timestamp;
    $("frameTheo").textContent = Number.isFinite(frame.theo)
      ? `Theo ES ${formatNumber(frame.theo)}`
      : "Theo ES —";

    for (const key of state.history.keys) {
      if (!frame.ranks[key]) continue;
      markerX.push(frame.timestamp);
      markerY.push(frame.ranks[key].strike);
      markerText.push(key.replace(` ${state.greek} `, " "));
    }

    Plotly.restyle(
      "timelapseChart",
      { x: [markerX], y: [markerY], text: [markerText] },
      [state.history.keys.length + 1]
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

    $("levelGrid").innerHTML = state.history.keys.map((key) => `
      <div class="level-chip ${key.startsWith("Call") ? "call" : "put"}">
        <div class="rank">${key}</div>
        <div class="strike">${frame.ranks[key] ? formatNumber(frame.ranks[key].strike) : "—"}</div>
      </div>
    `).join("");
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

  function startPlayback() {
    if (!state.history?.frames.length) return;

    if (state.playTimer) {
      stopPlayback();
      return;
    }

    $("playButton").textContent = "❚❚ Pause";
    state.playTimer = setInterval(() => {
      const next = state.frame >= state.history.frames.length - 1 ? 0 : state.frame + 1;
      updateFrame(next);
    }, 180);
  }

  function stopPlayback() {
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    $("playButton").textContent = "▶ Play";
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

  async function generateThinkscript() {
    clearError("thinkscriptError");
    const date = ymd($("thinkscriptDate").value);
    $("thinkscriptStatus").textContent = "Loading…";

    try {
      const text = await fetchText(raw("pusherman3000", historicalPath(date), false));
      const history = buildHistory(parseCSV(text));
      const frame = history.frames[history.frames.length - 1];

      if (!frame) throw new Error("No matching ranked levels.");

      const output = [
        "# CBCharts generated ranked levels",
        `# Source: ${date} ${C.buckets[state.bucket].label} ${state.greek}`,
        `# Frame: ${frame.timestamp}`,
        "",
        "input showLabels = yes;",
        ""
      ];

      for (const key of history.keys) {
        const point = frame.ranks[key];
        if (!point) continue;

        const variable = key.replaceAll(" ", "_");
        const color = key.startsWith("Call") ? "Color.GREEN" : "Color.RED";

        output.push(
          `plot ${variable} = ${formatCodeNumber(point.strike)};`,
          `${variable}.SetDefaultColor(${color});`,
          `${variable}.SetPaintingStrategy(PaintingStrategy.HORIZONTAL);`,
          `${variable}.SetLineWeight(2);`,
          ""
        );
      }

      if (Number.isFinite(frame.theo)) {
        output.push(
          `plot Theo_ES = ${formatCodeNumber(frame.theo)};`,
          "Theo_ES.SetDefaultColor(Color.YELLOW);",
          "Theo_ES.SetStyle(Curve.SHORT_DASH);",
          ""
        );
      }

      output.push(
        `AddLabel(showLabels, "${C.buckets[state.bucket].label} ${state.greek} | ${frame.timestamp}", Color.LIGHT_GRAY);`
      );

      $("thinkscriptOutput").value = output.join("\n");
      $("thinkscriptStatus").textContent = `Generated from ${frame.timestamp}`;
    } catch (error) {
      $("thinkscriptStatus").textContent = "Generation failed";
      showError("thinkscriptError", `Could not generate ThinkScript: ${error.message}`);
    }
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
    await Promise.allSettled([loadGauges(), loadVoltra(), loadVisual()]);
  }

  async function focusChanged() {
    state.history = null;

    // RatPack cards now depend on the selected Greek, so refresh the top strip too.
    if (state.ratpack) {
      ["Ratio", "Total", "Call", "Put"].forEach((metric) => {
        renderMetricGauge(metric, state.ratpack);
      });
    }

    if (state.view === "snapshot") await loadVisual();
    if (state.view === "timelapse") await loadHistory();
  }

  function wireEvents() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    $("bucketSelect").addEventListener("change", async (event) => {
      state.bucket = event.target.value;
      state.history = null;
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
    $("historyDate").addEventListener("change", loadHistory);

    $("timelineSlider").addEventListener("input", (event) => {
      stopPlayback();
      updateFrame(event.target.value);
    });

    $("playButton").addEventListener("click", startPlayback);
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
  }

  async function init() {
    loadStoredGraphSize();
    initControls();
    buildGaugeCards();
    initializeMultiMetricOptions();
    renderRepos();
    wireEvents();
    applyGraphSize(state.graphSize, false);
    setConnection(null, "Connecting");

    await refreshLive();

    setInterval(() => {
      loadGauges();
      loadVoltra();
      if (state.view === "snapshot") loadVisual();
    }, C.refreshMs);
  }

  init();
})();
