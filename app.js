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
    frame: 0
  };

  const plotConfig = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
  };

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
      return Math.max(1, Math.abs(value) * 1.15);
    }

    const related = ["Total", "Call", "Put"]
      .map((name) => Math.abs(metricValue(data, name)))
      .filter(Number.isFinite);

    const maxMagnitude = related.length ? Math.max(...related) : Math.abs(value);
    return Math.max(1, maxMagnitude * 1.08);
  }

  function renderMetricGauge(metric, data) {
    const value = metricValue(data, metric);
    const hasValue = Number.isFinite(value);
    const safeValue = hasValue ? value : 0;
    const magnitude = Math.abs(safeValue);
    const bound = gaugeBound(metric, safeValue, data);
    const positive = safeValue >= 0;
    const barColor = positive ? "#31d17c" : "#ff5f68";
    const backgroundColor = positive
      ? "rgba(49,209,124,.08)"
      : "rgba(255,95,104,.08)";

    $(`gauge-greek-${metric}`).textContent = `${state.greek} · ${C.buckets[state.bucket].label}`;
    $(`gauge-value-${metric}`).textContent = formatNumber(value);
    $(`gauge-value-${metric}`).classList.toggle("positive", positive && hasValue);
    $(`gauge-value-${metric}`).classList.toggle("negative", !positive && hasValue);
    $(`gauge-sign-${metric}`).textContent = !hasValue
      ? "NO DATA"
      : positive
        ? "POSITIVE"
        : "NEGATIVE";
    $(`gauge-sign-${metric}`).className = !hasValue
      ? "gauge-sign"
      : `gauge-sign ${positive ? "positive" : "negative"}`;

    Plotly.react(
      `gauge-${metric}`,
      [{
        type: "indicator",
        mode: "gauge",
        value: magnitude,
        gauge: {
          shape: "bullet",
          axis: {
            range: [0, bound],
            visible: false
          },
          bgcolor: "rgba(255,255,255,.025)",
          borderwidth: 0,
          bar: {
            color: barColor,
            thickness: 0.48
          },
          steps: [{ range: [0, bound], color: backgroundColor }]
        }
      }],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 12, r: 12, t: 2, b: 6 },
        height: 42
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

  function metricSpec() {
    return {
      volume: {
        title: "Call / put volume by strike",
        call: "call_vol_sum",
        put: "put_vol_sum",
        callLabel: "Call volume",
        putLabel: "Put volume"
      },
      oi: {
        title: "Call / put open interest by strike",
        call: "call_oi_sum",
        put: "put_oi_sum",
        callLabel: "Call OI",
        putLabel: "Put OI"
      },
      adjusted: {
        title: "Adjusted call / put volume by strike",
        call: "adj_call_vol",
        put: "adj_put_vol",
        callLabel: "Adjusted call volume",
        putLabel: "Adjusted put volume"
      },
      totalVolume: {
        title: "Total volume by strike",
        single: "total_vol_sum",
        singleLabel: "Total volume"
      },
      adjustedSum: {
        title: "Adjusted sum by strike",
        single: "adj_sum",
        singleLabel: "Adjusted sum"
      }
    }[$("snapshotMetric").value];
  }

  function renderVoltra() {
    const sourceRows = state.voltra.filter((row) =>
      row.timestamp &&
      Number.isFinite(Number(row.strikePrice))
    );

    if (!sourceRows.length) {
      Plotly.purge("voltraChart");
      showError("voltraError", "The selected Voltra file does not contain usable strike data.");
      return;
    }

    clearError("voltraError");

    const spec = metricSpec();
    $("voltraTitle").textContent = spec.title;

    // Snapshot means the newest timestamp only. This also prevents an older
    // timestamp in the same CSV from creating duplicate strike bars.
    const latestTimestamp = sourceRows
      .map((row) => String(row.timestamp))
      .sort()
      .at(-1);

    const latestRows = sourceRows.filter(
      (row) => String(row.timestamp) === latestTimestamp
    );

    const theoRow = latestRows.find((row) =>
      Number.isFinite(Number(row["Theo ES"]))
    );
    const theoES = Number(theoRow?.["Theo ES"]);

    // Only keep strikes that have actual data for the metric the user selected.
    // Zero/blank call + put rows are intentionally omitted from the Y-axis.
    const hasSelectedMetricData = (row) => {
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
      .filter(hasSelectedMetricData)
      .sort((a, b) => Number(a.strikePrice) - Number(b.strikePrice));

    if (!activeRows.length) {
      Plotly.purge("voltraChart");
      showError(
        "voltraError",
        `No non-zero ${spec.title.toLowerCase()} data is available for ${C.buckets[state.bucket].label} at ${latestTimestamp}.`
      );
      return;
    }

    const strikes = activeRows.map((row) => Number(row.strikePrice));

    // Use the actual strike spacing for bar thickness while keeping bars readable.
    const strikeDiffs = strikes
      .slice(1)
      .map((strike, index) => strike - strikes[index])
      .filter((diff) => Number.isFinite(diff) && diff > 0)
      .sort((a, b) => a - b);

    const medianStep = strikeDiffs.length
      ? strikeDiffs[Math.floor(strikeDiffs.length / 2)]
      : 25;

    const barWidth = Math.max(1, Math.min(25, medianStep * 0.72));
    const traces = [];

    if (spec.single) {
      const values = activeRows.map((row) => Number(row[spec.single]) || 0);

      traces.push({
        type: "bar",
        orientation: "h",
        name: spec.singleLabel,
        y: strikes,
        x: values,
        width: barWidth,
        customdata: values.map(formatNumber),
        marker: { color: "#5ba7ff" },
        hovertemplate:
          `Strike %{y}<br>${spec.singleLabel}: %{customdata}<extra></extra>`
      });
    } else {
      const callValues = activeRows.map((row) => Number(row[spec.call]) || 0);
      const putValues = activeRows.map((row) => Number(row[spec.put]) || 0);

      traces.push({
        type: "bar",
        orientation: "h",
        name: spec.callLabel,
        y: strikes,
        x: callValues,
        width: barWidth,
        customdata: callValues.map(formatNumber),
        marker: { color: "#49a5ff" },
        hovertemplate:
          `Strike %{y}<br>${spec.callLabel}: %{customdata}<extra></extra>`
      });

      traces.push({
        type: "bar",
        orientation: "h",
        name: spec.putLabel,
        y: strikes,
        x: putValues.map((value) => -Math.abs(value)),
        width: barWidth,
        customdata: putValues.map((value) => formatNumber(Math.abs(value))),
        marker: { color: "#ff6670" },
        hovertemplate:
          `Strike %{y}<br>${spec.putLabel}: %{customdata}<extra></extra>`
      });
    }

    const rangeValues = [...strikes];
    if (Number.isFinite(theoES)) rangeValues.push(theoES);

    const minY = Math.min(...rangeValues);
    const maxY = Math.max(...rangeValues);
    const span = Math.max(maxY - minY, medianStep);
    const yPadding = Math.max(medianStep * 0.7, span * 0.045);
    const yRange = [minY - yPadding, maxY + yPadding];

    // Give each data-bearing strike enough vertical room to remain readable.
    const chartHeight = Math.max(
      480,
      Math.min(1100, activeRows.length * 27 + 150)
    );
    $("voltraChart").style.height = `${chartHeight}px`;

    Plotly.react(
      "voltraChart",
      traces,
      {
        ...baseLayout,
        barmode: "relative",
        bargap: 0.18,
        margin: { l: 92, r: 92, t: 24, b: 56 },

        xaxis: {
          ...baseLayout.xaxis,
          title: {
            text: spec.single
              ? spec.singleLabel
              : "Calls (+) / Puts (mirrored)",
            font: { size: 10 }
          },
          tickformat: ",.3~f",
          exponentformat: "none",
          showexponent: "none",
          automargin: true
        },

        // Real numeric strike axis. Tick labels are restricted to strikes that
        // actually contain non-zero data for the selected metric.
        yaxis: {
          ...baseLayout.yaxis,
          title: {
            text: "Strike",
            standoff: 8,
            font: { size: 11 }
          },
          type: "linear",
          range: yRange,
          tickmode: "array",
          tickvals: strikes,
          ticktext: strikes.map(formatNumber),
          tickfont: { size: 9 },
          ticks: "outside",
          ticklen: 4,
          automargin: true
        },

        // Theo ES gets its own clean right-side axis. There is intentionally no
        // full-width yellow reference line in v0.3.
        yaxis2: {
          title: {
            text: "Theo ES",
            standoff: 8,
            font: { size: 11, color: "#f4b942" }
          },
          overlaying: "y",
          side: "right",
          type: "linear",
          range: yRange,
          tickmode: "array",
          tickvals: Number.isFinite(theoES) ? [theoES] : [],
          ticktext: Number.isFinite(theoES) ? [formatNumber(theoES)] : [],
          tickfont: { size: 10, color: "#f4b942" },
          tickcolor: "#f4b942",
          ticks: "outside",
          ticklen: 6,
          showgrid: false,
          zeroline: false,
          automargin: true
        },

        legend: {
          orientation: "h",
          x: 0,
          y: 1.035,
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

      const timestamp = state.voltra.find((row) => row.timestamp)?.timestamp;
      $("voltraTimestamp").textContent = timestamp ? `As of ${timestamp}` : "Latest";

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
    $("visualSourceLink").href = `https://github.com/CBCharts/BrentBSVisuals/blob/main/${file}`;
    $("visualLoading").classList.remove("hidden");
    $("visualFrame").classList.add("hidden");

    try {
      $("visualFrame").srcdoc = await fetchText(raw("BrentBSVisuals", file));
      $("visualLoading").classList.add("hidden");
      $("visualFrame").classList.remove("hidden");
    } catch (error) {
      $("visualLoading").classList.add("hidden");
      showError("visualError", `Could not load BrentBSVisuals: ${error.message}`);
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

    $("snapshotMetric").addEventListener("change", renderVoltra);
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
    initControls();
    buildGaugeCards();
    renderRepos();
    wireEvents();
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
