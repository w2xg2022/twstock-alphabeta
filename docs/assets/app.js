(function () {
  const searchInput = document.getElementById("search");
  const tbody = document.getElementById("result-body");
  const emptyEl = document.getElementById("empty");
  const metaEl = document.getElementById("meta");
  const table = document.getElementById("result-table");
  const marketToggle = document.getElementById("market-toggle");
  const windowToggle = document.getElementById("window-toggle");
  const trajSearch = document.getElementById("traj-search");
  const trajTitle = document.getElementById("traj-title");
  const trajWindowToggle = document.getElementById("traj-window-toggle");
  const metricToggle = document.getElementById("metric-toggle");
  const chartHint = document.getElementById("chart-hint");
  const trajResetZoom = document.getElementById("traj-reset-zoom");

  let stocks = [];
  let stocksByCode = {};
  let trajectoryData = null;
  let sortKey = "code";
  let sortAsc = true;
  let chartMarket = "ALL";
  let chartWindow = "120";
  let chartMetric = "alpha";
  let trajWindow = "120";
  let chart = null;
  let trajChart = null;

  const METRIC_LABEL = { er: "E(R) (CAPM年化期望報酬率)", alpha: "α (年化超額報酬)" };

  const NUM_KEYS = ["beta60", "alpha60", "beta120", "alpha120", "beta240", "alpha240"];

  const arrowPlugin = {
    id: "arrowPlugin",
    afterDatasetsDraw(c) {
      const { ctx } = c;
      c.data.datasets.forEach((dataset, dsIndex) => {
        if (!dataset.showLine) return;
        const meta = c.getDatasetMeta(dsIndex);
        const headlen = 7;
        ctx.save();
        for (let i = 0; i < meta.data.length - 1; i++) {
          const p0 = meta.data[i];
          const p1 = meta.data[i + 1];
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) continue;
          const ux = dx / dist;
          const uy = dy / dist;
          const tx = p1.x - ux * 6;
          const ty = p1.y - uy * 6;
          const angle = Math.atan2(dy, dx);
          const color = Array.isArray(dataset.pointBackgroundColor)
            ? dataset.pointBackgroundColor[i + 1]
            : dataset.pointBackgroundColor || "#0f766e";
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - headlen * Math.cos(angle - Math.PI / 6), ty - headlen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(tx - headlen * Math.cos(angle + Math.PI / 6), ty - headlen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });
    },
  };

  function fmtNum(v) {
    if (v === null || v === undefined) return "-";
    return v.toFixed(2);
  }

  function numClass(v) {
    if (v === null || v === undefined) return "";
    return v > 0 ? "pos" : v < 0 ? "neg" : "";
  }

  function render(list) {
    tbody.innerHTML = "";
    if (list.length === 0) {
      emptyEl.classList.remove("hidden");
      table.classList.add("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    table.classList.remove("hidden");

    const frag = document.createDocumentFragment();
    for (const s of list.slice(0, 200)) {
      const tr = document.createElement("tr");
      tr.dataset.code = s.code;
      tr.innerHTML = `
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td>${s.market === "TWSE" ? "上市" : "上櫃"}</td>
        <td class="${numClass(s.beta60)}">${fmtNum(s.beta60)}</td>
        <td class="${numClass(s.alpha60)}">${fmtNum(s.alpha60)}</td>
        <td class="${numClass(s.beta120)}">${fmtNum(s.beta120)}</td>
        <td class="${numClass(s.alpha120)}">${fmtNum(s.alpha120)}</td>
        <td class="${numClass(s.beta240)}">${fmtNum(s.beta240)}</td>
        <td class="${numClass(s.alpha240)}">${fmtNum(s.alpha240)}</td>
      `;
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  function sortList(list) {
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? av - bv : bv - av;
    });
  }

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    let list = stocks;
    if (q) {
      list = stocks.filter(
        (s) => s.code.includes(q) || s.name.toLowerCase().includes(q)
      );
    }
    render(sortList(list));
  }

  table.querySelectorAll("th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = NUM_KEYS.includes(key) ? false : true;
      }
      applyFilter();
    });
  });

  searchInput.addEventListener("input", applyFilter);

  function jumpToStock(code) {
    searchInput.value = code;
    applyFilter();
    const row = tbody.querySelector(`tr[data-code="${code}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("row-highlight");
      setTimeout(() => row.classList.remove("row-highlight"), 1500);
    }
  }

  function buildChart() {
    const ctx = document.getElementById("scatter-chart");
    if (!ctx || typeof Chart === "undefined") return;

    const bKey = `beta${chartWindow}`;
    const eKey = `${chartMetric}${chartWindow}`;
    const metricLabel = chartMetric === "er" ? "E(R)" : "α";
    const filtered = stocks.filter(
      (s) => (chartMarket === "ALL" || s.market === chartMarket) &&
        s[bKey] !== null && s[bKey] !== undefined &&
        s[eKey] !== null && s[eKey] !== undefined
    );

    const points = filtered.map((s) => ({ x: s[bKey], y: s[eKey], code: s.code, name: s.name }));

    const selectedCode = trajSearch.value.trim();
    const selInfo = stocksByCode[selectedCode];
    const selPoint = selInfo && selInfo[bKey] !== null && selInfo[bKey] !== undefined &&
      selInfo[eKey] !== null && selInfo[eKey] !== undefined
      ? [{ x: selInfo[bKey], y: selInfo[eKey], code: selInfo.code, name: selInfo.name }]
      : [];

    const datasets = [{
      label: `β/${metricLabel} (${chartWindow}日)`,
      data: points,
      backgroundColor: "rgba(15, 118, 110, 0.45)",
      pointRadius: 3,
      pointHoverRadius: 6,
    }];
    if (selPoint.length) {
      datasets.push({
        label: "已選股票",
        data: selPoint,
        backgroundColor: "#d97706",
        borderColor: "#92400e",
        borderWidth: 2,
        pointRadius: 9,
        pointHoverRadius: 11,
      });
    }

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: { title: { display: true, text: "β (系統性風險)" } },
          y: { title: { display: true, text: METRIC_LABEL[chartMetric] } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const p = item.raw;
                return `${p.code} ${p.name}  β=${p.x.toFixed(2)}  ${metricLabel}=${p.y.toFixed(2)}`;
              },
            },
          },
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const ds = datasets[elements[0].datasetIndex].data;
          const p = ds[elements[0].index];
          jumpToStock(p.code);
          trajSearch.value = p.code;
          updateTrajectory();
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
      },
    });
  }

  function sampleWeekly(points, step) {
    const result = [];
    for (let i = 0; i < points.length; i += step) result.push(points[i]);
    const last = points[points.length - 1];
    if (result[result.length - 1] !== last) result.push(last);
    return result;
  }

  function buildTrajectoryChart(code) {
    const ctx = document.getElementById("traj-chart");
    if (!ctx || typeof Chart === "undefined") return;

    const traj = trajectoryData && trajectoryData.stocks ? trajectoryData.stocks[code] : null;
    if (trajChart) trajChart.destroy();
    trajChart = null;
    if (!traj) return;

    const bArr = traj[`beta${trajWindow}`] || [];
    const eArr = traj[`er${trajWindow}`] || [];
    const points = [];
    for (let i = 0; i < bArr.length; i++) {
      if (bArr[i] !== null && bArr[i] !== undefined && eArr[i] !== null && eArr[i] !== undefined) {
        points.push({ x: bArr[i], y: eArr[i] });
      }
    }
    if (points.length === 0) return;

    const total = points.length;
    const pointColors = points.map((_, i) => {
      const t = total > 1 ? i / (total - 1) : 1;
      const alpha = 0.15 + 0.35 * t;
      return `rgba(107, 114, 128, ${alpha.toFixed(2)})`;
    });

    const weekly = sampleWeekly(points, 5);
    const weeklyTotal = weekly.length;

    trajChart = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: `每日實際位置 (${trajWindow}日)`,
            data: points,
            showLine: false,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            pointRadius: 2.5,
            pointHoverRadius: 6,
          },
          {
            label: "每週大方向",
            data: weekly,
            showLine: true,
            borderColor: "#d97706",
            borderWidth: 2.5,
            pointBackgroundColor: "#d97706",
            pointBorderColor: "#92400e",
            pointRadius: (ctx2) => (ctx2.dataIndex === weeklyTotal - 1 ? 7 : 4),
            pointHoverRadius: 9,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: { title: { display: true, text: "β (系統性風險)" } },
          y: { title: { display: true, text: "E(R) (CAPM年化期望報酬率)" } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const isWeekly = item.datasetIndex === 1;
                const isLast = isWeekly && item.dataIndex === weeklyTotal - 1;
                return `${isLast ? "最新 " : ""}${isWeekly ? "週" : ""}β=${item.raw.x.toFixed(2)}  E(R)=${item.raw.y.toFixed(2)}`;
              },
            },
          },
          zoom: {
            pan: { enabled: true, mode: "xy" },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "xy",
            },
          },
        },
      },
      plugins: [arrowPlugin],
    });
  }

  function updateTrajectory() {
    const code = trajSearch.value.trim();
    const info = stocksByCode[code];
    trajTitle.textContent = info ? `${info.name} (${code})` : code ? "找不到此代號" : "";
    buildTrajectoryChart(code);
    buildChart();
  }

  trajSearch.addEventListener("input", () => {
    clearTimeout(trajSearch._t);
    trajSearch._t = setTimeout(updateTrajectory, 300);
  });

  trajResetZoom.addEventListener("click", () => {
    if (trajChart && trajChart.resetZoom) trajChart.resetZoom();
  });

  trajWindowToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-window]");
    if (!btn) return;
    trajWindowToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    trajWindow = btn.dataset.window;
    updateTrajectory();
  });

  marketToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-market]");
    if (!btn) return;
    marketToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartMarket = btn.dataset.market;
    buildChart();
  });

  windowToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-window]");
    if (!btn) return;
    windowToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartWindow = btn.dataset.window;
    buildChart();
  });

  metricToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-metric]");
    if (!btn) return;
    metricToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartMetric = btn.dataset.metric;
    chartHint.textContent = chartMetric === "er"
      ? "橫軸為β（系統性風險）、縱軸為E(R)（CAPM年化期望報酬率）。點一下圖上的點可跳到下方表格查看該股。"
      : "橫軸為β（系統性風險）、縱軸為α（年化超額報酬）。點一下圖上的點可跳到下方表格查看該股。";
    buildChart();
  });

  Promise.all([
    fetch("data/alphabeta.json").then((r) => r.json()),
    fetch("data/trajectory.json").then((r) => r.json()).catch(() => null),
  ])
    .then(([data, trajData]) => {
      stocks = data.stocks || [];
      stocksByCode = Object.fromEntries(stocks.map((s) => [s.code, s]));
      trajectoryData = trajData;
      metaEl.textContent = `共 ${data.count} 檔，更新時間：${data.updated_at}（UTC）`;
      applyFilter();
      buildChart();
      updateTrajectory();
    })
    .catch((err) => {
      metaEl.textContent = "資料載入失敗";
      console.error(err);
    });
})();
