/**
 * Core Abacus simulation, projection engine, and interactive visualization library.
 * Handles baseline extraction, Markov-chain land cover projections, carbon emission estimations,
 * transition probability matrix (TPM) editing, and responsive D3 charts (bar, matrix, streamgraph).
 * @module abacus
 */

/**
 * Checks whether a value is defined.
 * @param {*} v - Value to check.
 * @returns {boolean} True if defined, false otherwise.
 */
function is_exist(v) {
  if (typeof v == "undefined") return false;
  return true;
}

/**
 * Validates and clamps an area value to a non-negative number with 6 decimal places.
 * @param {number} a - Raw area value in hectares.
 * @returns {number} Non-negative area rounded to 6 decimal places.
 */
function validate_area(a) {
  const precision = 1000000;
  return d3.max([0, Math.round((a + Number.EPSILON) * precision) / precision]);
}

/**
 * Aggregates land cover transition area by zone and land cover category.
 * @param {Array<Object>} lc_data - Land cover transition records.
 * @param {boolean} [is_converted_lc=true] - If true, aggregates by destination category (lc2_id); if false, by source (lc1_id).
 * @returns {Array<Object>} Array of objects with zone_id, lc1_id, and total area.
 */
function sum_lc_area(lc_data, is_converted_lc = true) {
  let sum_area = d3.rollups(
    lc_data,
    (v) => d3.sum(v, (d) => validate_area(d.area)),
    (d) => d.zone_id,
    (d) => (is_converted_lc ? d.lc2_id : d.lc1_id)
  );
  return sum_area
    .map((d) =>
      d[1].map((e) => ({
        zone_id: d[0],
        lc1_id: e[0],
        area: validate_area(e[1]),
      }))
    )
    .flat(1);
}

/**
 * Extracts initial land cover area and transition probability matrix (TPM) from project data.
 * @param {Object} abacus_data - Raw project dataset containing landcover, area, and TPM tables.
 * @returns {{tpm: Array<Object>, area: Array<Object>}} Initial baseline TPM rates and areas.
 */
function get_baseline_data(abacus_data) {
  let base_data = abacus_data.landcover_change.filter(
    (d) =>
      d.scenario_id === 0 && d.iteration_id === 0 && validate_area(d.area) > 0
  );

  let lc_area = sum_lc_area(base_data, false);
  //generate TPM
  let base_tpm = base_data.map((d) => ({
    zone_id: d.zone_id,
    lc1_id: d.lc1_id,
    lc2_id: d.lc2_id,
    r:
      validate_area(d.area) /
      lc_area.find((e) => e.zone_id === d.zone_id && e.lc1_id === d.lc1_id)
        .area,
  }));
  //add TPM items if lc2 has more ids than lc1 to keep the lc area on the next iteration
  let tpm_add = [];
  let area_add = [];
  d3.union(base_tpm.map((d) => d.zone_id)).forEach((e) => {
    let data = base_tpm.filter((f) => f.zone_id == e);
    let t1 = d3.union(data.map((g) => g.lc1_id));
    let t2 = d3.union(data.map((g) => g.lc2_id));
    let id_dif = Array.from(d3.difference(t2, t1));
    if (id_dif.length > 0) {
      let t = id_dif.map((g) => ({ zone_id: e, lc1_id: g, lc2_id: g, r: 1 }));
      tpm_add = tpm_add.concat(t);
      let a = id_dif.map((g) => ({ zone_id: e, lc1_id: g, area: 0 }));
      area_add = area_add.concat(a);
    }
  });
  base_tpm = base_tpm.concat(tpm_add);
  lc_area = lc_area.concat(area_add);

  return {
    tpm: base_tpm,
    area: lc_area,
  };
}

/**
 * Ensures baseline TPM and area records support all transition pairs present in a scenario.
 * Adds zero-rate transitions and zero-area entries for any new categories.
 * @param {{tpm: Array<Object>, area: Array<Object>}} baseline - Baseline data structure.
 * @param {Array<Object>} scenario - Scenario transition records.
 */
function ensure_baseline_supports_scenario(baseline, scenario) {
  if (!baseline) return;
  if (!baseline.tpm) baseline.tpm = [];
  if (!baseline.area) baseline.area = [];
  if (!scenario || !Array.isArray(scenario) || scenario.length === 0) return;

  scenario.forEach((sc) => {
    // 1. Ensure the transition exists in baseline.tpm (r = 0 default)
    const exists = baseline.tpm.some(
      (d) => d.zone_id == sc.zone_id && d.lc1_id == sc.lc1_id && d.lc2_id == sc.lc2_id
    );
    if (!exists) {
      baseline.tpm.push({
        zone_id: sc.zone_id,
        lc1_id: sc.lc1_id,
        lc2_id: sc.lc2_id,
        r: 0,
      });
    }

    // 2. Ensure destination lc2_id has a persistent self-transition in baseline.tpm so converted area persists
    const has_dest_out = baseline.tpm.some(
      (d) => d.zone_id == sc.zone_id && d.lc1_id == sc.lc2_id
    );
    if (!has_dest_out) {
      baseline.tpm.push({
        zone_id: sc.zone_id,
        lc1_id: sc.lc2_id,
        lc2_id: sc.lc2_id,
        r: 1,
      });
    }

    // 3. Ensure destination lc2_id exists in baseline.area (initial area 0 if not present)
    const has_dest_area = baseline.area.some(
      (d) => d.zone_id == sc.zone_id && d.lc1_id == sc.lc2_id
    );
    if (!has_dest_area) {
      baseline.area.push({
        zone_id: sc.zone_id,
        lc1_id: sc.lc2_id,
        area: 0,
      });
    }

    // 4. Ensure source lc1_id exists in baseline.area (initial area 0 if not present)
    const has_src_area = baseline.area.some(
      (d) => d.zone_id == sc.zone_id && d.lc1_id == sc.lc1_id
    );
    if (!has_src_area) {
      baseline.area.push({
        zone_id: sc.zone_id,
        lc1_id: sc.lc1_id,
        area: 0,
      });
    }
  });
}

/**
 * Runs a Markov-chain projection over n iterations combining baseline TPM and scenario overrides.
 * Computes land cover areas and transition matrices for each iteration step.
 * @param {{tpm: Array<Object>, area: Array<Object>}} baseline - Baseline TPM and initial area.
 * @param {Array<Object>|null} [scenario=null] - User-defined scenario transition overrides.
 * @param {number} [n=1] - Number of projection iterations.
 * @returns {{lc_tpm: Array<Object>, lc_area: Array<Object>, lc_sum_area: Array<Object>}} Projected transitions, areas, and sums.
 */
function iterate_projection(baseline, scenario = null, n = 1) {
  let b_tpm = baseline && baseline.tpm ? structuredClone(baseline.tpm) : [];
  let b_area = baseline && baseline.area ? structuredClone(baseline.area) : [];

  if (scenario && Array.isArray(scenario) && scenario.length > 0) {
    const temp_b = { tpm: b_tpm, area: b_area };
    ensure_baseline_supports_scenario(temp_b, scenario);
    b_tpm = temp_b.tpm;
    b_area = temp_b.area;
  }

  let lc_area = b_area.map((d) => ({ iteration: 0, ...d }));
  let lc_sum_arr = lc_area;
  let lc_arr = null;

  /**
   * Retrieves the scenario transition rate (r) applicable for a given step, falling back to default.
   * @param {number} def_r - Default baseline transition rate.
   * @param {number} [iteration=0] - Current projection iteration step.
   * @param {number} [zone_id=0] - Zone identifier.
   * @param {number} [lc1_id=0] - Source land cover ID.
   * @param {number} [lc2_id=0] - Destination land cover ID.
   * @returns {number} The applicable transition rate.
   */
  function get_sc_r(def_r, iteration = 0, zone_id = 0, lc1_id = 0, lc2_id = 0) {
    if (scenario == null) return def_r;
    if (!Array.isArray(scenario)) return def_r;
    //find the r scenario from the earlier iteration
    const sc = scenario.filter(
      (d) =>
        d.iteration <= iteration &&
        d.zone_id == zone_id &&
        d.lc1_id == lc1_id &&
        d.lc2_id == lc2_id
    );
    if (typeof sc == "undefined") return def_r;
    if (sc.length == 0) return def_r;
    if (sc.length > 1) {
      //apply r on the latest iteration
      sc.sort((a, b) => b.iteration - a.iteration);
    }
    return sc[0].r;
  }

  /**
   * Looks up the initial or current area for a given zone and source land cover.
   * @param {number} zone_id - Zone identifier.
   * @param {number} lc1_id - Source land cover ID.
   * @returns {number} Area in hectares, or 0 if not found.
   */
  function get_area(zone_id, lc1_id) {
    const a = lc_area.find((f) => f.zone_id == zone_id && f.lc1_id == lc1_id);
    if (typeof a == "undefined") return 0;
    return a.area;
  }

  for (let i = 0; i < n + 1; ++i) {
    let a_data = b_tpm.map((e) => {
      const r = get_sc_r(e.r, i, e.zone_id, e.lc1_id, e.lc2_id);
      return {
        iteration: i,
        zone_id: e.zone_id,
        lc1_id: e.lc1_id,
        lc2_id: e.lc2_id,
        r: r,
        area:
          get_area(e.zone_id, e.lc1_id) * r,
      };
    });
    lc_arr = lc_arr == null ? a_data : [...lc_arr, ...a_data];
    let sum_area = d3.rollups(
      a_data,
      (v) => d3.sum(v, (d) => d.area),
      (d) => d.zone_id,
      (d) => d.lc2_id
    );
    lc_area = sum_area
      .map((d) =>
        d[1].map((e) => ({
          iteration: i + 1,
          zone_id: d[0],
          lc1_id: e[0],
          area: validate_area(e[1]),
        }))
      )
      .flat(1);
    lc_sum_arr = [...lc_sum_arr, ...lc_area];
  }
  return { lc_area: lc_arr, lc_sum_area: lc_sum_arr };
}

/**
 * Computes net carbon emissions and removals from projected land cover changes over time.
 * @param {Array<Object>} carbonstock - Carbon stock definitions per land cover and zone.
 * @param {Object} projection_data - Projected transitions and areas from iterate_projection.
 * @param {Array<Object>|null} [other_factor=null] - Other emission factors (e.g. peat, fire).
 * @param {number} [period=0] - Number of elapsed years per iteration step.
 * @param {Object|null} [abacus_data=null] - Optional abacus project metadata.
 * @returns {Object} Emission breakdowns by zone, iteration, and transition.
 */
function get_carbon_emission(
  carbonstock,
  projection_data,
  other_factor = null,
  period = 0,
  abacus_data = null
) {
  /**
   * Retrieves carbon stock value for a specific land cover, zone, and iteration.
   * @param {number} lc_id - Land cover ID.
   * @param {number} [zone_id=0] - Zone ID.
   * @param {number} [iteration=0] - Iteration step.
   * @returns {number} Carbon stock in Mg C/ha.
   */
  function get_c(lc_id, zone_id = 0, iteration = 0) {
    let cr = carbonstock.find(
      (d) =>
        d.lc_id == lc_id &&
        (typeof d.zone_id === "undefined" || d.zone_id == zone_id || d.zone_id == 0) &&
        (typeof d.iteration_id === "undefined" || d.iteration_id == iteration || d.iteration_id == 0)
    );

    if (typeof cr !== "undefined" && typeof cr.c !== "undefined" && cr.c !== null) return cr.c;
    if (abacus_data && abacus_data.carbonstock) {
      let cb = abacus_data.carbonstock.find((d) => d.lc_id == lc_id && d.scenario_id == 0);
      if (cb && typeof cb.c !== "undefined" && cb.c !== null) return cb.c;
    }
    return 0;
  }

  /**
   * Retrieves other annual emission factors (e.g. peat drainage, non-CO2 gases).
   * @param {number} lc_id - Land cover ID.
   * @param {number} [zone_id=0] - Zone ID.
   * @param {number} [iteration=0] - Iteration step.
   * @returns {number} Annual other emissions in Mg CO2-eq/ha/yr.
   */
  function get_other_e(lc_id, zone_id = 0, iteration = 0) {
    if (!other_factor) return 0;
    let cr;
    if (zone_id) {
      cr = other_factor.find((d) => d.lc_id == lc_id && d.zone_id == zone_id);
    } else {
      cr = other_factor.find((d) => d.lc_id == lc_id);
    }

    if (typeof cr == "undefined") return 0;
    return cr.efactor * period;
  }

  let lc_area = projection_data.lc_area;
  const lc_e = lc_area.map((d) => ({
    ...d,
    emission: ((get_c(d.lc1_id) - get_c(d.lc2_id)) * d.area * 44) / 12,
    emission_other:
      ((get_other_e(d.lc1_id) + get_other_e(d.lc2_id)) * d.area) / 2,
  }));

  const zone_e_sum = d3.rollups(
    lc_e,
    //TODO: to be check, addition of e-other
    (v) => d3.sum(v, (d) => d.emission + d.emission_other),

    (d) => d.zone_id,
    (d) => d.iteration
  );

  const zone_e = zone_e_sum
    .map((d) =>
      d[1].map((e) => ({
        zone_id: d[0],
        iteration: e[0],
        emission: e[1],
      }))
    )
    .flat(1);

  const itr_e_sum = d3.rollups(
    zone_e,
    (v) => d3.sum(v, (d) => d.emission),
    (d) => d.iteration
  );

  const itr_e = itr_e_sum
    .map((d) => ({ iteration: d[0], emission: d[1] }))
    .flat(1);

  return {
    lc_emission: lc_e,
    zone_emission: zone_e,
    iteration_emission: itr_e,
  };
}

/**
 * Computes baseline land cover projection and emissions for a specified number of iterations.
 * @param {Object} abacus_data - Abacus project data.
 * @param {number} iteration - Total projection iterations.
 * @returns {Object} Baseline projection results including data, baseline, projection, and emissions.
 */
function get_baseline_projection(abacus_data, iteration) {
  let b, proj, cstock;
  b = get_baseline_data(abacus_data);
  proj = iterate_projection(b, null, iteration);
  cstock = abacus_data.carbonstock.filter((d) => d.scenario_id == 0);

  return {
    data: abacus_data,
    baseline: b,
    iteration: iteration,
    projection: proj,
    emission: get_carbon_emission(
      cstock,
      proj,
      abacus_data.other_emission_factor,
      date_diff_year(abacus_data.project.date1, abacus_data.project.date2),
      abacus_data
    ),
  };
}

/**
 * Parses diverse date string formats (YYYY-MM-DD, DD/MM/YYYY, etc.) into a Date object.
 * @param {string|Date} input - Raw date string or Date object.
 * @returns {Date} Parsed JavaScript Date.
 */
function parseDate(input) {
  if (!input) return new Date();
  if (input instanceof Date) return input;
  if (typeof input === "string") {
    var parts = input.match(/(\d+)/g);
    if (parts && parts.length >= 3) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
  }
  return new Date(input);
}

/**
 * Calculates the difference between two dates in fractional years.
 * @param {Date} d1 - Start date.
 * @param {Date} d2 - End date.
 * @returns {number} Difference in years.
 */
function date_diff_year(d1, d2) {
  if (!d1 || !d2) return 1;
  d1 = parseDate(d1);
  d2 = parseDate(d2);
  let weeks = Math.round((d2 - d1) / (7 * 24 * 60 * 60 * 1000));
  let yrs = weeks / 52.25;
  return isNaN(yrs) || yrs <= 0 ? 1 : yrs;
}

/**
 * Initializes and coordinates the scenario conversion editor interface.
 * Manages zone/period selection, view toggling (stacked bar vs matrix), dialog popups, and updates.
 * @param {string|HTMLElement} id_div - Target container selector or element.
 * @param {Object} baseline_projection - Baseline projection output.
 * @param {string} LIB_PATH - Path to icon and image assets.
 * @param {Function} updateValue - Shiny callback function for propagating updates.
 * @param {Object|null} [scenario=null] - Existing scenario configuration.
 * @param {number} [selected_iteration=1] - Active iteration index.
 * @param {number} [selected_zone=0] - Active zone ID.
 * @param {number} [selected_lc=0] - Active land cover ID.
 * @param {number} [width=700] - Render width in pixels.
 * @param {string} [initial_view_mode="bar"] - Initial view mode ("bar" or "matrix").
 * @param {boolean} [editable=true] - Whether scenario editing is enabled.
 */
function show_lc_conversion(
  id_div,
  baseline_projection,
  LIB_PATH,
  updateValue,
  scenario = null,
  selected_iteration = 1,
  selected_zone = 0,
  selected_lc = 0,
  width = 700,
  initial_view_mode = "bar",
  editable = true
) {
  var n_iteration = baseline_projection.iteration;

  const abacus_data = baseline_projection.data;
  const cstock = abacus_data.carbonstock.filter((d) => d.scenario_id == 0);
  var scenario_tpm = null;
  var baseline = null;
  var b_projection = baseline_projection.projection;
  var projection = null;
  var emission = null;
  var lc_edit;
  var lc_edit_default;
  var edited_period_id = 1;
  var edited_zone_id = 0; //abacus_data.zone[0].zone_id;
  var edited_lc1_id = 0;
  var edited_lc1_id_list = [];
  var period_yr = 0;

  if(abacus_data.zone && abacus_data.zone.length > 0) {
    edited_zone_id = abacus_data.zone[0].zone_id;
  }

  if (
    selected_iteration !== null &&
    typeof selected_iteration !== "undefined" &&
    !Number.isNaN(Number(selected_iteration))
  ) {
    edited_period_id = selected_iteration;
  }

  if (selected_zone !== null && typeof selected_zone !== "undefined" && !Number.isNaN(Number(selected_zone))) {
    edited_zone_id = Number(selected_zone);
  }

  if (selected_lc) {
    edited_lc1_id = selected_lc;
  }

  if (abacus_data.version == 2) {
    period_yr = date_diff_year(
      abacus_data.project.date1,
      abacus_data.project.date2
    );
  }

  /**
   * Computes the calendar year corresponding to projection iteration step i.
   * @param {number} i - Iteration step index.
   * @returns {number} Projected calendar year.
   */
  function get_iteration_year(i) {
    if (abacus_data.version == 1) {
      const b0 = Array.isArray(abacus_data.project.baseyear0) ? abacus_data.project.baseyear0[0] : abacus_data.project.baseyear0;
      const b1 = Array.isArray(abacus_data.project.baseyear1) ? abacus_data.project.baseyear1[0] : abacus_data.project.baseyear1;
      const p = [Number(b0) || 2000, Number(b1) || 2010];

      if (i <= 1) return p[i];
      return p[1] + (i - 1) * (p[1] - p[0]);
    } else if (abacus_data.version == 2) {
      const d1 = parseDate(abacus_data.project.date1);
      return (
        d1.getFullYear() + Math.round(period_yr) * i
      );
    }
    return 2000 + i;
  }

  /**
   * Generates a human-readable period label for iteration step i (e.g. "2020 - 2025").
   * @param {number} i - Iteration step index.
   * @returns {string} Formatted period label.
   */
  function get_period_label(i) {
    if (abacus_data.version == 2) {
      period_yr = date_diff_year(
        abacus_data.project.date1,
        abacus_data.project.date2
      );
    }
    return get_iteration_year(i) + "-" + get_iteration_year(i + 1);
  }

  //PANEL LAYOUT
  const is_node = id_div && typeof id_div !== "string";
  const h = is_node ? d3.select(id_div) : d3.select(document.getElementById(id_div) || ("#" + id_div));
  const container_node = h.node();
  if (!container_node) {
    console.error("show_lc_conversion: container element not found:", id_div);
    return;
  }
  const div_prefix = is_node ? (id_div.id || "luchart") : id_div;
  h.selectAll("*").remove();

  // View mode toggle (bar chart / matrix)
  let view_mode = initial_view_mode;
  const toggle_wrap = h.append("div").attr("class", "lc-view-toggle");
  const btn_bar_view = toggle_wrap.append("button")
    .attr("class", "lc-view-btn lc-view-btn-bar" + (initial_view_mode !== "matrix" ? " lc-view-btn-active" : ""))
    .attr("id", div_prefix + "_btn_view_bar")
    .text("▬ Bar")
    .on("click", () => {
      view_mode = "bar";
      btn_bar_view.classed("lc-view-btn-active", true);
      btn_matrix_view.classed("lc-view-btn-active", false);
      update_chart(false);
    });
  const btn_matrix_view = toggle_wrap.append("button")
    .attr("class", "lc-view-btn lc-view-btn-matrix" + (initial_view_mode === "matrix" ? " lc-view-btn-active" : ""))
    .attr("id", div_prefix + "_btn_view_matrix")
    .text("⊞ Matrix")
    .on("click", () => {
      view_mode = "matrix";
      btn_matrix_view.classed("lc-view-btn-active", true);
      btn_bar_view.classed("lc-view-btn-active", false);
      update_chart(false);
    });

  const chart_div_id = div_prefix + "_lc_chart";
  const lc_chart_div = h.append("div")
    .attr("id", chart_div_id)
    .attr("class", "lc_chart")
    .style("flex", "1 1 auto")
    .style("min-height", "0")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("position", "relative")
    .style("overflow", "visible");

  const dialog = editable ? h.append("dialog").attr("id", div_prefix + "_dialog_tpm") : null;
  let btn_close, btn_cancel, btn_update, edit_tpm_div;
  if (dialog) {
    edit_tpm_div = dialog.append("div").attr("id", div_prefix + "_edit_tpm");
    const dialog_b = dialog
      .append("div")
      .style("margin-top", "20px")
      .attr("class", "d-grid gap-2 d-md-flex justify-content-md-end");
    btn_close = dialog_b
      .append("button")
      .attr("id", div_prefix + "_close_tpm")
      .attr("class", "btn btn-outline-secondary")
      .text("Close")
      .on("click", cancel_tpm);
    btn_cancel = dialog_b
      .append("button")
      .attr("id", div_prefix + "_cancel_tpm")
      .attr("class", "btn btn-outline-secondary")
      .text("Cancel")
      .on("click", cancel_tpm);
    btn_update = dialog_b
      .append("button")
      .attr("id", div_prefix + "_update_tpm")
      .attr("class", "btn btn-outline-secondary")
      .text("Update")
      .on("click", update_tpm);
  }

  if (scenario && scenario.tpm && Array.isArray(scenario.tpm) && scenario.tpm.length > 0) {
    scenario_tpm = scenario.tpm;
    baseline = {
      tpm: scenario.baseline_tpm ? structuredClone(scenario.baseline_tpm) : structuredClone(baseline_projection.baseline.tpm),
      area: scenario.baseline_area ? structuredClone(scenario.baseline_area) : structuredClone(baseline_projection.baseline.area)
    };
    ensure_baseline_supports_scenario(baseline, scenario_tpm);
      } else {
    scenario_tpm = null;
    baseline = structuredClone(baseline_projection.baseline);
    projection = structuredClone(b_projection);
    emission = baseline_projection.emission;
  }
  if (!scenario) {
    scenario = {};
  }
  if (!scenario.landcover || !scenario.landcover[0] || typeof scenario.landcover[0].c === "undefined") {
    scenario.landcover = abacus_data.landcover.map((d) => {
      const cs = cstock.find((e) => e.lc_id == d.lc_id);
      return {
        ...d,
        zone_id: 0,
        iteration_id: 0,
        c: cs ? cs.c : 0,
      };
    });
  }
  if (!scenario.new_lc_id) {
    scenario.new_lc_id = [];
  }

  trigger_scenario_update();


  /**
   * Refreshes active visual views (bar chart or matrix table) based on current selections.
   * @param {boolean} [update_all=true] - Whether to re-render all dependent sub-charts.
   */
  function update_chart(update_all = true) {
    const zone_id = edited_zone_id;
    edited_lc1_id_list = [];
    let edited_conversions = [];
    let locked_scenario_items = [];
    if (scenario_tpm != null && Array.isArray(scenario_tpm)) {
      locked_scenario_items = scenario_tpm.filter(
        (d) =>
          d.iteration == edited_period_id &&
          d.zone_id == zone_id &&
          (d.lock === true || d.lock === "TRUE" || d.lock === 1)
      );
      if (typeof locked_scenario_items != "undefined" && locked_scenario_items.length > 0) {
        edited_lc1_id_list = Array.from(d3.union(locked_scenario_items.map((d) => d.lc1_id)));
        edited_conversions = locked_scenario_items.map((d) => `${d.lc1_id}_${d.lc2_id}`);
      }
    }
    const lc_data = projection.lc_area.filter(
      (d) =>
        d.iteration == edited_period_id &&
        d.zone_id == zone_id &&
        (d.area > 0 || (edited_conversions && edited_conversions.some((p) => p == `${d.lc1_id}_${d.lc2_id}`)))
    );
    if (locked_scenario_items.length > 0) {
      locked_scenario_items.forEach((sc) => {
        const found = lc_data.find((d) => d.lc1_id == sc.lc1_id && d.lc2_id == sc.lc2_id);
        if (!found) {
          lc_data.push({
            iteration: edited_period_id,
            zone_id: zone_id,
            lc1_id: sc.lc1_id,
            lc2_id: sc.lc2_id,
            r: sc.r || 0,
            area: sc.area || 0,
          });
        }
      });
    }
    lc_chart_div.selectAll("*").remove();
    if (view_mode === "matrix") {
      get_lc_matrix_view(
        lc_chart_div.node(),
        lc_data,
        scenario.landcover,
        editable ? open_edit : null,
        edited_lc1_id_list,
        edited_conversions,
        div_prefix
      );
    } else {
      const plot = get_lc_conv_plot(
        lc_data.filter((d) => d.area > 0),
        scenario.landcover,
        editable ? open_edit : null,
        edited_lc1_id_list,
        width,
        edited_conversions,
        div_prefix
      );
      if (plot) {
        lc_chart_div.node().appendChild(plot);
      }
    }
  }

  /**
   * Updates the selected iteration period and updates UI controls.
   * @param {number} period_id - Iteration period index.
   */
  function select_period(period_id) {
    edited_period_id = period_id;
    update_chart(false);
    trigger_selection();
  }

  /**
   * Updates the selected planning zone and updates UI controls.
   * @param {number} zone_id - Zone ID.
   */
  function select_zone(zone_id) {
    edited_zone_id = zone_id;
    update_chart();
    trigger_selection();
  }

  /**
   * Triggers an update event sending currently selected zone, period, and land cover to Shiny.
   */
  function trigger_selection() {
    updateValue(
      "selection:js_to_df",
      JSON.stringify({
        iteration: edited_period_id,
        zone: edited_zone_id,
        lc: edited_lc1_id,
      })
    );
  }

  /**
   * Updates total projection iterations and recomputes the projection.
   * @param {number} n - Number of iterations.
   */
  function update_n_iteration(n) {
    i = Number(n);
    if (!i) {
      d3.select("#n_iteration").property("value", n_iteration);
      return;
    }
    i = Math.max(1, Math.min(50, i));
    d3.select("#n_iteration").property("value", i);
    n_iteration = i;
    baseline_projection = get_baseline_projection(abacus_data, n_iteration);
    b_projection = baseline_projection.projection;
    updateValue("baseline:js_to_df", JSON.stringify(baseline_projection));
    trigger_scenario_update();
    update_chart();
  }

  /**
   * Opens the TPM conversion editor dialog for a specific source land cover category.
   * @param {number} lc1_id - Source land cover ID.
   * @param {number} [lc2_id] - Optional destination land cover ID to highlight.
   */
  function open_edit(lc1_id, lc2_id) {
    if (!editable || !dialog) return;
    edited_lc1_id = lc1_id;
    trigger_selection();
    if (btn_close && btn_cancel && btn_update) {
      if (edited_period_id == 0) {
        btn_close.style("display", "inline-block");
        btn_cancel.style("display", "none");
        btn_update.style("display", "none");
      } else {
        btn_close.style("display", "none");
        btn_cancel.style("display", "inline-block");
        btn_update.style("display", "inline-block");
      }
    }

    var lc_tpm = projection.lc_area.filter(
      (d) =>
        d.iteration == edited_period_id &&
        d.zone_id == edited_zone_id &&
        d.lc1_id == edited_lc1_id
    );

    /**
     * Checks whether a conversion to lc2_id has been explicitly locked by user edits.
     * @param {number} lc2_id - Destination land cover ID.
     * @returns {boolean} True if locked, false otherwise.
     */
    function is_locked_sc(lc2_id) {
      if (scenario_tpm == null) return false;
      const s = scenario_tpm.find(
        (d) =>
          d.iteration == edited_period_id &&
          d.zone_id == edited_zone_id &&
          d.lc1_id == edited_lc1_id &&
          d.lc2_id == Number(lc2_id) &&
          (d.lock === true || d.lock === "TRUE" || d.lock === 1)
      );
      if (typeof s == "undefined") return false;
      return true;
    }

    lc_tpm = lc_tpm.map((d) => ({ ...d, lock: is_locked_sc(d.lc2_id) }));
    
    var scenario_tpm_prev = null;
    if (scenario_tpm != null) {
      scenario_tpm_prev = scenario_tpm.filter(
        (d) =>
          !(
            d.iteration == edited_period_id &&
            d.zone_id == edited_zone_id &&
            d.lc1_id == edited_lc1_id
          )
      );
    }

    const prev_projection = iterate_projection(
      baseline,
      scenario_tpm_prev,
      n_iteration
    );

    var lc_tpm_prev =
      edited_period_id <= 0
        ? null
        : prev_projection.lc_area.filter(
            (d) =>
              d.iteration == edited_period_id &&
              d.zone_id == edited_zone_id &&
              d.lc1_id == edited_lc1_id
          );
    lc_edit_default = lc_tpm_prev == null ? lc_tpm : lc_tpm_prev;

    /**
     * Adds a newly edited transition row to the active edit buffer.
     * @param {Object} row_tpm - Transition object.
     * @returns {Array<Object>} Updated buffer.
     */
    function add_row_tpm(row_tpm) {
      lc_edit.push(row_tpm);
      return lc_edit;
    }

    
    /**
     * Replaces the active edit buffer with updated transition records.
     * @param {Array<Object>} le - New edit buffer array.
     */
    function update_lc_edit(le) {
      lc_edit = le;
    }

    lc_edit_obj = edit_tpm(
      edit_tpm_div.node(),
      lc_tpm,
      lc_tpm_prev,
      edited_lc1_id,
      scenario.landcover,
      get_period_label(edited_period_id),
      edited_period_id == 0,
      LIB_PATH,
      add_row_tpm,
      update_lc_edit
    );
    dialog.node().showModal();
    const b = lc_chart_div.node().getBoundingClientRect();
    const bd = edit_tpm_div.node().getBoundingClientRect();
    dialog.node().style.left = (b.width / 2 - bd.width / 2) + "px";
    dialog.node().style.top = (b.top + 10) + "px";
    selectInput(lc2_id);
  }

  /**
   * Looks up the label for a land cover ID in the scenario dataset.
   * @param {number} lc_id - Land cover ID.
   * @returns {string} Label string.
   */
  function get_lc(lc_id) {
    const l = scenario.landcover.find((d) => d.lc_id == lc_id);
    if (typeof l == "undefined") return "";
    return l.label;
  }

  /**
   * Commits modal dialog edits to the scenario TPM and re-calculates the scenario projection.
   */
  function update_tpm() {
    dialog.node().close();
    var locked = lc_edit.filter((d) => d.lock);
    if (locked.length > 0) {
      const plabel = get_period_label(edited_period_id);
      var zone = "";

      if (baseline_projection.data.zone) {
        if (baseline_projection.data.zone.length > 0)
          zone = baseline_projection.data.zone.find(
            (d) => d.zone_id == edited_zone_id
          ).label;
      }
      const lc1 = get_lc(edited_lc1_id);
      /**
   * Retrieves baseline default transition rate or area for a destination category.
   * @param {number} lc2_id - Destination land cover ID.
   * @param {string} [v="r"] - Value type to retrieve ('r' for rate, 'area' for hectares).
   * @returns {number} Default value.
   */
  function get_default_lc(lc2_id, v = "r") {
        const lc = lc_edit_default.find((e) => e.lc2_id == lc2_id);
        if (lc) {
          if (v == "r") {
            return lc.r;
          } else if (v == "area") {
            return lc.area;
          }
        }
        return 0;
      }
      var t = lc_edit.map((d) => ({
        ...d,
        period: plabel,
        zone: zone,
        lc1: lc1,
        lc2: get_lc(d.lc2_id),
        def_r: get_default_lc(d.lc2_id, "r"), //lc_edit_default.find((e) => e.lc2_id == d.lc2_id).r,
        def_area: get_default_lc(d.lc2_id, "area"), //lc_edit_default.find((e) => e.lc2_id == d.lc2_id).area,
      }));

      //check if there were new conversion from baseline
      const lc2_edit = t.map((d) => d.lc2_id);
      const lc2_base = baseline.tpm
        .filter((d) => d.zone_id == edited_zone_id && d.lc1_id == edited_lc1_id)
        .map((d) => d.lc2_id);
      const diff = Array.from(d3.difference(lc2_edit, lc2_base));
      if (diff.length > 0) {
        //add default r = 0 for the baseline
        const add_lc = diff.map((d) => ({
          zone_id: edited_zone_id,
          lc1_id: edited_lc1_id,
          lc2_id: d,
          r: 0,
        }));
        baseline.tpm = [...baseline.tpm, ...add_lc];

        //add constant r = 1 if it has no baseline conversion to keep the conversion sustain

        //if the lc is new, assume that it has no conversion on the next iteration (r = 1)
        var lc1_base = baseline.tpm
          .filter((d) => d.zone_id == edited_zone_id)
          .map((d) => d.lc1_id);
        lc1_base = d3.union(lc1_base.values());
        const t_diff = Array.from(d3.difference(diff, lc1_base));
        if (t_diff.length > 0) {
          const add_lc_base = t_diff.map((d) => ({
            zone_id: edited_zone_id,
            lc1_id: d,
            lc2_id: d,
            r: 1,
          }));
          baseline.tpm = [...baseline.tpm, ...add_lc_base];
        }

        const afilt = baseline.area
          .filter((d) => d.zone_id == edited_zone_id)
          .map((d) => d.lc1_id);
        const a_diff = Array.from(d3.difference(diff, afilt));
        if (a_diff.length > 0) {
          const add_area = a_diff.map((d) => ({
            zone_id: edited_zone_id,
            lc1_id: d,
            area: 0,
          }));
          baseline.area = [...baseline.area, ...add_area];
        }
      }
      ensure_baseline_supports_scenario(baseline, t);

      if (scenario_tpm == null) {
        scenario_tpm = t;
      } else {
        scenario_tpm = scenario_tpm.filter(
          (d) =>
            !(
              d.iteration == edited_period_id &&
              d.zone_id == edited_zone_id &&
              d.lc1_id == edited_lc1_id
            )
        );
        scenario_tpm = [...scenario_tpm, ...t];
      }
    } else {
      if (scenario_tpm)
        scenario_tpm = scenario_tpm.filter(
          (d) =>
            !(
              d.iteration == edited_period_id &&
              d.zone_id == edited_zone_id &&
              d.lc1_id == edited_lc1_id
            )
        );
    }

    trigger_scenario_update();
    update_chart();
    lc_edit = null;
  }

  /**
   * Recomputes projection and emissions from updated scenario TPM and notifies Shiny.
   */
  function trigger_scenario_update() {
    if (scenario_tpm != null && Array.isArray(scenario_tpm) && scenario_tpm.length > 0) {
      projection = iterate_projection(baseline, scenario_tpm, n_iteration);
      emission = get_carbon_emission(
        scenario.landcover,
        projection,
        abacus_data.other_emission_factor,
        date_diff_year(abacus_data.project.date1, abacus_data.project.date2),
        abacus_data
      );
    } else {
      projection = structuredClone(b_projection);
      emission = baseline_projection.emission;
    }

    if (editable && updateValue) updateValue(
      "update:js_to_df",
      JSON.stringify({
        scenario: {
          tpm: scenario_tpm,
          baseline_tpm: baseline.tpm,
          baseline_area: baseline.area,
          landcover: scenario.landcover,
          new_lc_id: scenario.new_lc_id,
          label: scenario.label,
          description: scenario.description,
        },
        projection: projection,
        emission: emission,
        baseline_emission: baseline_projection.emission,
      })
    );
  }

  /**
   * Cancels active edits in the modal dialog without saving changes.
   */
  function cancel_tpm() {
    if (dialog && dialog.node()) dialog.node().close();
  }

  update_chart();

  // Expose open_edit so the widget factory can wire custom-message navigation
  if (container_node) {
    container_node._abacus_open_edit = function(lc1_id) {
      open_edit(lc1_id, lc1_id);
    };
  }
}

/**
 * Renders a horizontal stacked bar chart showing land cover transitions from source categories.
 * Supports interactive hovering to display preview subplots and clicking to edit transitions.
 * @param {Array<Object>} lc_data - Land cover transition area records.
 * @param {Array<Object>} landcovers - Land cover category definitions (labels, colors).
 * @param {Function} click_function - Click event handler callback.
 * @param {number|null} edited_lc1 - Currently active source land cover ID.
 * @param {number} width - SVG width in pixels.
 * @param {Array<Object>} [edited_conversions=[]] - List of transitions with active user edits.
 * @param {string} [id_prefix=""] - Prefix for element and clip-path IDs.
 * @returns {SVGElement} Rendered D3 SVG element.
 */
function get_lc_conv_plot(
  lc_data,
  landcovers,
  click_function,
  edited_lc1,
  width,
  edited_conversions = [],
  id_prefix = ""
) {
  // Specify the chart’s dimensions.
  const marginTop = 80;
  const marginRight = 100;
  const marginBottom = 20;
  let marginLeft = 200;
  const widthSubplot = 400;
  const f = d3.format(",.0f");
  const f2 = d3.format(".2%");

  // Determine the series that need to be stacked.
  const series = d3
    .stack()
    // distinct series keys, in input order
    .keys(d3.union(lc_data.map((d) => d.lc2_id)))
    // get value for each series key and stack
    .value(([, D], key) =>
      typeof D.get(key) === "undefined" ? 0 : D.get(key).area
    )(
    d3.index(
      lc_data,
      (d) => d.lc1_id,
      (d) => d.lc2_id
    )
  ); // group by stack then series key

  if (series.length == 0) return;
  const lc_area = Array.from(
    d3.rollup(
      lc_data,
      (v) => d3.sum(v, (d) => d.area),
      (d) => d.lc1_id
    ),
    ([lc1_id, area]) => ({ lc1_id, area })
  );

  /**
   * Returns display label for a land cover ID.
   * @param {number} lc_id - Land cover ID.
   * @returns {string} Display label.
   */
  function get_lc_label(lc_id) {
    const lc = landcovers.find((o) => o.lc_id == lc_id);
    if (typeof lc == "undefined") return "";
    return lc.label;
  }

  const lc_labels = lc_area.map((d) => get_lc_label(d.lc1_id));

  const swatchSize    = 12;
  const swatchGap     = 8;
  const leftPad       = 14;
  const maxLabelLen   = d3.max(lc_labels, (d) => d.length) || 10;
  const maxLabelWidth = Math.ceil(maxLabelLen * 8.5);
  marginLeft          = leftPad + swatchSize + swatchGap + maxLabelWidth + 18;

  const totalWidth = Math.max(width, marginLeft + 350);

  // Compute the height from the number of stacks.
  const height = series[0].length * 25 + marginTop + marginBottom;

  // Prepare the scales for positional and color encodings.
  const x = d3
    .scaleLinear()
    .domain([0, d3.max(series, (d) => d3.max(d, (d) => d[1]))])
    .range([marginLeft, totalWidth - marginRight]);

  const y = d3
    .scaleBand()
    .domain(d3.sort(d3.union(lc_data.map((d) => d.lc1_id))))
    .range([marginTop, height - marginBottom])
    .padding(0.08);

  /**
   * Returns assigned color hex for a land cover ID.
   * @param {number} lc_id - Land cover ID.
   * @returns {string} Hex color string.
   */
  function get_color(lc_id) {
    lc = landcovers.find((d) => d.lc_id == lc_id);
    if (lc) return lc.color;
    return "gray";
  }

  // Create the SVG container.
  const svg = d3
    .create("svg")
    .attr("width", totalWidth)
    .attr("height", height)
    .attr("viewBox", [0, 0, totalWidth, height])
    .attr("style", "max-width: 100%; height: auto; overflow: visible;");

  const defs = svg.append("defs");
  landcovers.forEach((lc) => {
    const p = defs
      .append("pattern")
      .attr("id", (id_prefix ? id_prefix + "_" : "") + "pattern-same-lc-" + lc.lc_id)
      .attr("width", 10)
      .attr("height", 10)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(45)");

    p.append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", lc.color || "gray");

    p.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 10)
      .attr("stroke", "rgba(255, 255, 255, 0.5)")
      .attr("stroke-width", 3.5);

    p.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 10)
      .attr("stroke", "rgba(0, 0, 0, 0.2)")
      .attr("stroke-width", 1);
  });

  // Append a group for each series, and a rect for each element in the series.
  svg
    .append("g")
    .selectAll()
    .data(series)
    .join("g")
    .attr("fill", (d) => get_color(d.key))
    .selectAll("rect")
    .data((D) => D.map((d) => ((d.key = D.key), d)))
    .join("rect")
    .attr("fill", (d) =>
      d.data[0] === d.key ? `url(#${id_prefix ? id_prefix + "_" : ""}pattern-same-lc-${d.key})` : get_color(d.key)
    )
    .attr("stroke", (d) =>
      edited_conversions && edited_conversions.some((p) => p == `${d.data[0]}_${d.key}`)
        ? "#dc3545"
        : null
    )
    .attr("stroke-width", (d) =>
      edited_conversions && edited_conversions.some((p) => p == `${d.data[0]}_${d.key}`)
        ? 2
        : null
    )
    .attr("x", (d) => x(d[0]))
    .attr("y", (d) => y(d.data[0]))
    .attr("height", y.bandwidth())
    .attr("width", (d) => x(d[1]) - x(d[0])) //;
    .on("pointerenter pointermove", pointermoved_x)
    .on("pointerleave", pointerleft_x)
    .on("click", (e, d) => trigger_click(d.data[0], d.key))
    .on("touchstart", (event) => event.preventDefault());

  // Append the horizontal axis.
  svg
    .append("g")
    .attr("transform", `translate(0,${marginTop})`)
    .call(d3.axisTop(x).ticks(width / 100, "s"))
    .call((g) => g.selectAll(".domain").remove());

  // Append the vertical axis.
  const yaxis = svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .style("font-size", "1em")
    .call(
      d3
        .axisLeft(y)
        .tickSizeOuter(0)
        .tickFormat((d) => get_lc_label(d))
    );

  const tickTextX = -marginLeft + leftPad + swatchSize + swatchGap;
  const swatchX   = -marginLeft + leftPad;

  yaxis
    .selectAll(".tick")
    .on("pointerenter pointermove", pointermoved_y)
    .on("pointerleave", pointerleft_y)
    .on("click", (e, d) => trigger_click(d))
    .each(function(d) {
      const tick = d3.select(this);
      const is_edited = edited_lc1 && edited_lc1.some((id) => id == d);

      // Left-aligned text directly following the swatch
      tick.select("text")
        .attr("text-anchor", "start")
        .attr("x", tickTextX)
        .attr("fill", is_edited ? "#dc3545" : "currentColor")
        .style("fill", is_edited ? "#dc3545" : "currentColor")
        .style("color", is_edited ? "#dc3545" : "currentColor")
        .style("font-weight", is_edited ? "700" : "normal")
        .attr("id", "lc" + d);

      // Color swatch cleanly on the left of land cover
      tick.append("rect")
        .attr("class", "lc-tick-swatch" + (is_edited ? " lc-tick-swatch-edited" : ""))
        .attr("x", swatchX)
        .attr("y", -swatchSize / 2)
        .attr("width", swatchSize)
        .attr("height", swatchSize)
        .attr("rx", 2)
        .attr("fill", get_color(d))
        .attr("stroke", is_edited ? "#dc3545" : "rgba(0,0,0,0.25)")
        .attr("stroke-width", is_edited ? 2 : 0.8);

      if (is_edited) {
        tick.append("circle")
          .attr("class", "lc-edited-bullet")
          .attr("cx", swatchX - 6)
          .attr("cy", 0)
          .attr("r", 3)
          .attr("fill", "#dc3545");
      }
    });

  // Append a label for each y ticks.
  svg
    .append("g")
    .attr("fill", "black")
    .attr("text-anchor", "start")
    .style("font-size", "0.8em")
    .selectAll()
    .data(lc_area)
    .join("text")
    .attr("x", (d) => x(d.area))
    .attr("y", (d) => y(d.lc1_id) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("dx", +4)
    .text((d) => f(d.area));

  svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "start")
    .attr("x", leftPad)
    .attr("y", marginTop - 40)
    .attr("font-weight", 700)
    .style("font-size", "1.1em")
    .text("↓ Converted land cover");

  // Add X axis label:
  svg
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", width - 10)
    .attr("y", marginTop - 40)
    .style("font-size", "1em")
    .text("Converted area (ha)");

  // Create the tooltip container.
  const tooltip = svg.append("g");
  const disp_conv = svg.append("g");

  /**
   * Handles pointer leave event on horizontal bar segment.
   * @param {PointerEvent} event - Pointer event.
   * @param {Object} edata - Stack data.
   */
  function pointerleft_x(event, edata) {
    tooltip.style("display", "none");
    const el = yaxis.select("text#lc" + edata.data[0]);
    el.attr("font-weight", 300);
    el.style("font-size", "1em");
    event.target.setAttribute("stroke", null);
  }

  /**
   * Handles pointer leave on Y-axis label or tick, hiding conversion preview.
   * @param {PointerEvent} event - Pointer event.
   * @param {Object} edata - Axis data.
   */
  function pointerleft_y(event, edata) {
    disp_conv.style("display", "none");
    const el = yaxis.select("text#lc" + edata);
    const is_edited = edited_lc1 && edited_lc1.some((id) => id == edata);
    el.attr("font-weight", is_edited ? "700" : "normal");
    el.style("font-size", "1em");
  }

  // Add the event listeners that show or hide the tooltip.
  /**
   * Handles pointer movement over bar segment, positioning tooltip and highlighting category.
   * @param {PointerEvent} event - Pointer event.
   * @param {Object} edata - Hovered segment data.
   */
  function pointermoved_x(event, edata) {
    tooltip.style("display", null);
    d3.select(this).style("cursor", click_function ? "pointer" : "default");
    const lc_x_label = landcovers.find((o) => o.lc_id == edata.key).label;
    const lc_y_label = landcovers.find((o) => o.lc_id == edata.data[0]).label;
    const area = edata.data[1].get(edata.key).area;
    const r = edata.data[1].get(edata.key).r;
    const el = yaxis.select("text#lc" + edata.data[0]);
    el.attr("font-weight", 700);
    el.style("font-size", "1.1em");

    event.target.setAttribute("stroke", "black");
    const { x: xp, y: yp, width: wp, height: hp } = event.target.getBBox();
    tooltip.attr("transform", `translate(${xp + wp / 2},${yp})`);
    const path = tooltip
      .selectAll("path")
      .data([,])
      .join("path")
      .attr("fill", "white")
      .attr("opacity", 0.9)
      .attr("stroke", "black");
    const t_arr = [
      lc_y_label,
      edata.data[0] == edata.key ? "same land cover (persisting as)" : "conversion to",
      lc_x_label,
      `${f(area)} ha [${f2(r)}]`,
    ];
    const s_arr = [0.7, 0.7, 0.8, 0.9];
    const text = tooltip
      .selectAll("text")
      .data([,])
      .join("text")
      .call((text) =>
        text
          .selectAll("tspan")
          .data(t_arr)
          .join("tspan")
          .attr("x", 0)
          .attr("dy", (_, i) => (i === 0 ? "-0.4em" : "1.2em"))
          .attr("font-weight", (_, i) => (i !== 1 ? "bold" : null))
          .attr("font-size", (_, i) => s_arr[i] + "em")
          .text((d) => d)
      );

    const { x, y, width: w, height: h } = text.node().getBBox();
    text.attr("transform", `translate(${-w / 2},${-h})`);
    path.attr(
      "d",
      `M${-5},-5H-5l5,5l5,-5H${w / 2}q10,0,10,-10v${-h}q0,-10,-10,-10,
                h-${w},q-10,0,-10,10,v${h},q0,10,10,10,z`
    );
  }

  /**
   * Handles pointer hover over Y-axis label, displaying detailed transition breakdown subplot.
   * @param {PointerEvent} event - Pointer event.
   * @param {number} lc_id - Source land cover ID.
   */
  function pointermoved_y(event, lc_id) {
    lc_id = Number(lc_id);
    var trans_tick = (this && this.getAttribute && this.getAttribute("transform")) || (event.target && event.target.getAttribute && event.target.getAttribute("transform"));
    if (!trans_tick && this && this.parentNode && this.parentNode.getAttribute) {
      trans_tick = this.parentNode.getAttribute("transform");
    }
    if (!trans_tick) return;
    d3.select(this).style("cursor", "pointer");
    const el = yaxis.select("text#lc" + lc_id);
    el.attr("font-weight", 700);
    el.style("font-size", "1.1em");

    const matches = trans_tick.match(/(-?[0-9\.]+)/g) || [0, 0];
    const yt = Number(matches[1] !== undefined ? matches[1] : matches[0]) || 0;
    disp_conv.selectAll("*").remove();
    disp_conv.style("display", null);
    const path = disp_conv
      .selectAll("path")
      .data([,])
      .join("path")
      .attr("fill", "white")
      .attr("opacity", 0.9)
      .attr("stroke", "black");

    const lc_single = lc_data
      .filter((d) => d.lc1_id == lc_id && d.area > 0)
      .map((d) => {
        const lc2 = landcovers.find((e) => e.lc_id == d.lc2_id);
        return {
          ...d,
          label: lc2 ? lc2.label : String(d.lc2_id),
          color: lc2 ? lc2.color : "green",
        };
      });
    if (lc_single.length === 0) {
      disp_conv.style("display", "none");
      return;
    }
    const lc_obj = landcovers.find((e) => e.lc_id == lc_id);
    const lc_label = lc_obj ? lc_obj.label : String(lc_id);
    const plot = get_single_lc_plot(
      lc_single,
      lc_label,
      widthSubplot,
      id_prefix
    );

    const bplot = disp_conv
      .selectAll("g")
      .data([,])
      .enter()
      .append((d) => plot)
      .attr("y", 20);

    let { x, y, width: w, height: h } = bplot.node().getBBox();
    h += 20;
    const ypos = Math.max(-yt + 10, Math.min(height - yt - h - 20, -h / 2));
    disp_conv.attr(
      "transform",
      trans_tick + `translate(${marginLeft + 10},${ypos - 10})`
    );
    path.attr(
      "d",
      `M0,${-ypos}l-10,10l10,10V${
        h + 10
      }q0,10,10,10h${widthSubplot}q10,0,10,-10,
                  v-${h}q0,-10,-10,-10,h${-widthSubplot}q-10,0,-10,10,z`
    );
  }

  /**
   * Handles click on bar or label, opening the edit dialog.
   * @param {number} lc1_id - Source land cover ID.
   * @param {number} lc2_id - Destination land cover ID.
   */
  function trigger_click(lc1_id, lc2_id) {
    if (click_function === null) return;
    click_function(lc1_id, lc2_id);
  }

  return svg.node();
}

// -----------------------------------------------------------------------
// Matrix view: renders an HTML table showing LC→LC transition areas/rates
// with the same open_edit interaction as the bar chart.
// -----------------------------------------------------------------------
/**
 * Renders an interactive matrix (pivot table) of land cover conversions (LC1 rows to LC2 columns).
 * Supports toggle between area (ha) and rate (%), sticky headers, and click-to-edit interactions.
 * @param {string|HTMLElement} div_id - Target container element.
 * @param {Array<Object>} lc_data - Transition data records.
 * @param {Array<Object>} landcovers - Land cover metadata array.
 * @param {Function} click_function - Handler invoked on row/cell edit click.
 * @param {number|null} edited_lc1 - Currently edited source land cover ID.
 * @param {Array<Object>} [edited_conversions=[]] - Array of user-edited transitions.
 * @param {string} [id_prefix=""] - Prefix for element IDs.
 */
function get_lc_matrix_view(div_id, lc_data, landcovers, click_function, edited_lc1, edited_conversions = [], id_prefix = "") {
  const f  = d3.format(",.0f");
  const f2 = d3.format(".1%");
  let show_rate = false;

  // All unique lc1 (rows) and lc2 (cols), sorted ascending
  const all_lc1 = Array.from(d3.union(lc_data.map(d => d.lc1_id))).sort(d3.ascending);
  const all_lc2 = Array.from(d3.union(lc_data.map(d => d.lc2_id))).sort(d3.ascending);

  // Ensure all edited conversions are present in all_lc1 and all_lc2
  if (edited_conversions && edited_conversions.length > 0) {
    edited_conversions.forEach((p) => {
      const parts = p.split("_").map(Number);
      if (!all_lc1.includes(parts[0])) all_lc1.push(parts[0]);
      if (!all_lc2.includes(parts[1])) all_lc2.push(parts[1]);
    });
    all_lc1.sort(d3.ascending);
    all_lc2.sort(d3.ascending);
  }

  // Cell lookup: "lc1_lc2" -> {area, r}
  const cell_map = new Map();
  lc_data.forEach(d => {
    const is_edited = edited_conversions && edited_conversions.some(p => p == `${d.lc1_id}_${d.lc2_id}`);
    if (d.area > 0 || is_edited) cell_map.set(`${d.lc1_id}_${d.lc2_id}`, { area: d.area || 0, r: d.r || 0 });
  });

  /**
   * Finds land cover metadata record by ID in matrix view.
   * @param {number} lc_id - Land cover ID.
   * @returns {{label: string, color: string}} Land cover metadata object.
   */
  function get_lc(lc_id) {
    const lc = landcovers.find(d => d.lc_id == lc_id);
    return lc || { label: String(lc_id), color: "#aaaaaa" };
  }

  // --- Render into target div ---
  const wrap = d3.select(div_id);
  wrap.selectAll("*").remove();
  wrap.style("position", "relative");

  // Floating popup for single LC bar chart (identical to bar view hover)
  const popup = wrap.append("div").attr("class", "lc-matrix-popup");

  /**
   * Shows a floating subplot popup previewing conversions from the hovered matrix row.
   * @param {number} lc1_id - Source land cover ID.
   */
  function show_row_popup(lc1_id) {
    const lc_single = lc_data
      .filter((d) => d.lc1_id == lc1_id && d.area > 0)
      .map((d) => {
        const lc2 = landcovers.find((e) => e.lc_id == d.lc2_id);
        return {
          ...d,
          label: lc2 ? lc2.label : String(d.lc2_id),
          color: lc2 ? lc2.color : "green",
        };
      });

    if (lc_single.length === 0) {
      hide_row_popup();
      return;
    }

    popup.selectAll("*").remove();
    const lc1_obj = landcovers.find((e) => e.lc_id == lc1_id);
    const lc1_label = lc1_obj ? lc1_obj.label : String(lc1_id);
    const plot = get_single_lc_plot(lc_single, lc1_label, 400, id_prefix);
    if (plot) {
      popup.node().appendChild(plot);
      popup.style("display", "block");
      position_row_popup.call(this);
    }
  }

  /**
   * Dynamically positions the row preview popup adjacent to the hovered row within viewport bounds.
   */
  function position_row_popup() {
    if (popup.style("display") === "none") return;
    const thRect   = this.getBoundingClientRect();
    const wrapRect = wrap.node().getBoundingClientRect();
    const top  = thRect.top - wrapRect.top - 8;
    const left = thRect.right - wrapRect.left + 10;
    popup
      .style("top", Math.max(0, top) + "px")
      .style("left", left + "px");
  }

  /**
   * Hides the matrix row conversion preview popup.
   */
  function hide_row_popup() {
    popup.style("display", "none");
    popup.selectAll("*").remove();
  }

  // Area / Rate toggle
  const ctrl = wrap.append("div").attr("class", "lc-matrix-controls");
  ctrl.append("span").attr("class", "lc-matrix-ctrl-label").text("Show: ");
  const btn_area = ctrl.append("button")
    .attr("class", "lc-matrix-val-btn lc-matrix-val-active")
    .text("Area (ha)");
  const btn_rate = ctrl.append("button")
    .attr("class", "lc-matrix-val-btn")
    .text("Rate (%)");

  // Scrollable wrapper + table
  const scroll = wrap.append("div").attr("class", "lc-matrix-scroll");
  scroll.on("scroll", hide_row_popup);
  const table  = scroll.append("table").attr("class", "lc-matrix-table");

  const grand_total_area = d3.sum(lc_data, d => (d.area > 0 ? d.area : 0));

  // --- Header row ---
  const thead = table.append("thead");
  const hrow  = thead.append("tr");

  // Corner cell
  hrow.append("th")
    .attr("class", "lc-matrix-corner")
    .append("span").attr("class", "lc-corner-label").html('From <i class="fa-solid fa-arrow-down fas fa-arrow-down" style="font-size:0.85em"></i> &nbsp; To <i class="fa-solid fa-arrow-right fas fa-arrow-right" style="font-size:0.85em"></i>');

  // One column header per lc2
  all_lc2.forEach(lc2_id => {
    const lc2   = get_lc(lc2_id);
    const th    = hrow.append("th").attr("class", "lc-matrix-col-header");
    const inner = th.append("div").attr("class", "lc-matrix-header-inner");
    inner.append("span")
      .attr("class", "lc-color-swatch")
      .style("background-color", lc2.color);
    inner.append("span")
      .attr("class", "lc-matrix-header-label")
      .attr("title", lc2.label)
      .text(lc2.label);
  });

  // Total column header
  const th_tot = hrow.append("th")
    .attr("class", "lc-matrix-col-header lc-matrix-total-header");
  const inner_tot = th_tot.append("div").attr("class", "lc-matrix-header-inner");
  inner_tot.append("span")
    .attr("class", "lc-matrix-header-label")
    .style("font-weight", "700")
    .text("Total Area (ha)");

  // --- Body rows ---
  const tbody = table.append("tbody");

  all_lc1.forEach(lc1_id => {
    const lc1       = get_lc(lc1_id);
    const is_edited = edited_lc1 && edited_lc1.some((id) => id == lc1_id);
    const tr        = tbody.append("tr")
      .attr("class", "lc-matrix-row" + (is_edited ? " lc-matrix-row-edited" : ""));

    // Row header (click → open edit for whole lc1 row; hover → show bar chart popup)
    const th = tr.append("th")
      .attr("class", "lc-matrix-row-header")
      .style("cursor", click_function ? "pointer" : "default")
      .on("click", () => {
        if (click_function) click_function(lc1_id, undefined);
      })
      .on("mouseenter", function() {
        d3.select(this).classed("lc-matrix-hovered", true);
        show_row_popup.call(this, lc1_id);
      })
      .on("mouseleave", function() {
        d3.select(this).classed("lc-matrix-hovered", false);
        hide_row_popup();
      });

    const rinner = th.append("div").attr("class", "lc-matrix-header-inner");
    rinner.append("span")
      .attr("class", "lc-color-swatch")
      .style("background-color", lc1.color);
    rinner.append("span")
      .attr("class", "lc-matrix-header-label" + (is_edited ? " lc-matrix-edited" : ""))
      .attr("title", lc1.label)
      .text(lc1.label);

    // Data cells
    all_lc2.forEach(lc2_id => {
      const cell = cell_map.get(`${lc1_id}_${lc2_id}`);
      const lc2  = get_lc(lc2_id);
      const is_cell_edited = edited_conversions && edited_conversions.some((p) => p == `${lc1_id}_${lc2_id}`);

      if (cell || is_cell_edited) {
        const area_val = cell ? (cell.area || 0) : 0;
        const r_val    = cell ? (cell.r || 0) : 0;
        const is_same_lc = lc1_id == lc2_id;
        const td = tr.append("td")
          .attr("class", "lc-matrix-cell" + (is_cell_edited ? " lc-matrix-cell-edited" : ""))
          .attr("data-lc1", lc1_id)
          .attr("data-lc2", lc2_id)
          .style("background-color", is_cell_edited ? "#ffe4e4" : (is_same_lc ? "#e8e8e8" : lc2.color + "44"))
          .style("cursor", click_function ? "pointer" : "default")
          .attr("title", `${lc1.label} ${is_same_lc ? "→ (same land cover)" : "→ " + lc2.label}\n${f(area_val)} ha  (${f2(r_val)})`)
          .on("click",     () => { if (click_function) click_function(lc1_id, lc2_id); })
          .on("mouseover", function() { d3.select(this).classed("lc-matrix-hovered", true); })
          .on("mouseout",  function() { d3.select(this).classed("lc-matrix-hovered", false); });
        td.append("span")
          .attr("class", "lc-cell-val" + (is_cell_edited ? " lc-cell-val-edited" : ""))
          .text(show_rate ? f2(r_val) : f(area_val));
      } else {
        // Blank cell for zero / no transition
        tr.append("td")
          .attr("class", "lc-matrix-cell lc-matrix-cell-empty");
      }
    });

    // Row total cell (always sum of area in ha)
    const row_cells = all_lc2.map(lc2_id => cell_map.get(`${lc1_id}_${lc2_id}`)).filter(Boolean);
    const row_tot_a = d3.sum(row_cells, c => c.area);

    const td_row_tot = tr.append("td")
      .attr("class", "lc-matrix-cell lc-matrix-total-cell lc-matrix-row-total")
      .attr("data-lc1", lc1_id)
      .attr("title", `${lc1.label} Total Area: ${f(row_tot_a)} ha`);
    td_row_tot.append("span")
      .attr("class", "lc-cell-total-val")
      .text(f(row_tot_a));
  });

  // --- Footer row (Total row) ---
  const tfoot = table.append("tfoot");
  const ftr   = tfoot.append("tr").attr("class", "lc-matrix-total-row");

  const fth   = ftr.append("th").attr("class", "lc-matrix-row-header lc-matrix-total-header");
  const finn  = fth.append("div").attr("class", "lc-matrix-header-inner");
  finn.append("span")
    .attr("class", "lc-matrix-header-label")
    .style("font-weight", "700")
    .text("Total Area (ha)");

  // One cell per lc2 (always sum of area in ha)
  all_lc2.forEach(lc2_id => {
    const col_tot_a = d3.sum(all_lc1, lc1_id => {
      const c = cell_map.get(`${lc1_id}_${lc2_id}`);
      return c ? c.area : 0;
    });
    const lc2 = get_lc(lc2_id);

    const td = ftr.append("td")
      .attr("class", "lc-matrix-cell lc-matrix-total-cell lc-matrix-col-total")
      .attr("data-lc2", lc2_id)
      .attr("title", `Total Area to ${lc2.label}: ${f(col_tot_a)} ha`);
    td.append("span")
      .attr("class", "lc-col-total-val")
      .text(f(col_tot_a));
  });

  // Grand total cell (always sum of area in ha)
  const td_grand = ftr.append("td")
    .attr("class", "lc-matrix-cell lc-matrix-total-cell lc-matrix-grand-total")
    .attr("title", `Grand Total Area: ${f(grand_total_area)} ha`);
  td_grand.append("span")
    .attr("class", "lc-grand-total-val")
    .text(f(grand_total_area));

  // --- Value toggle handlers ---
  /**
   * Updates matrix cells between area in hectares and percentage transition rates.
   */
  function refresh_values() {
    tbody.selectAll(".lc-cell-val").each(function() {
      const td     = d3.select(this.parentNode);
      const lc1_id = +td.attr("data-lc1");
      const lc2_id = +td.attr("data-lc2");
      const cell   = cell_map.get(`${lc1_id}_${lc2_id}`);
      const area_v = cell ? (cell.area || 0) : 0;
      const r_v    = cell ? (cell.r || 0) : 0;
      d3.select(this).text(show_rate ? f2(r_v) : f(area_v));
    });
  }

  btn_area.on("click", () => {
    show_rate = false;
    btn_area.classed("lc-matrix-val-active", true);
    btn_rate.classed("lc-matrix-val-active", false);
    refresh_values();
  });

  btn_rate.on("click", () => {
    show_rate = true;
    btn_rate.classed("lc-matrix-val-active", true);
    btn_area.classed("lc-matrix-val-active", false);
    refresh_values();
  });
}

/**
 * Renders a mini horizontal bar chart showing destination breakdown for a single source land cover.
 * @param {Array<Object>} lc_area - Transition area records for this source.
 * @param {string} lc_label - Source land cover name.
 * @param {number} [width=600] - Subplot width.
 * @param {string} [id_prefix=""] - Prefix for SVG pattern IDs.
 * @returns {SVGElement} Subplot SVG node.
 */
function get_single_lc_plot(lc_area, lc_label, width = 600, id_prefix = "") {
  const barHeight = 25;
  const marginTop = 40;
  const marginRight = 20;
  const marginBottom = 0;
  let marginLeft = 180;
  const height =
    Math.ceil((lc_area.length + 0.1) * barHeight) + marginTop + marginBottom;
  marginLeft = d3.max(lc_area, (d) => d.label.length) * 5 + 30;

  // Create the scales.
  const x = d3
    .scaleLinear()
    .domain([0, d3.max(lc_area, (d) => d.area)])
    .range([marginLeft, width - marginRight]);

  const y = d3
    .scaleBand()
    .domain(d3.sort(lc_area, (d) => d.lc2_id).map((d) => d.label))
    .rangeRound([marginTop, height - marginBottom])
    .padding(0.1);

  // Create a value format.
  const format = d3.format(",.0f");

  // Create the SVG container.
  const svg = d3
    .create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto;");

  /**
 * Determines optimal text color ('#000000' or '#ffffff') for legibility against a background hex color.
 * @param {string} hex - Background hex color code.
 * @returns {string} Black or white hex color code.
 */
function get_contrast_color(hex) {
    if (!hex || typeof hex !== "string" || hex.length < 6) return "#fff";
    const c = hex.replace("#", "");
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? "#111" : "#fff";
  }

  // Pattern definitions for persisting same land cover
  const defs = svg.append("defs");
  lc_area.forEach((d) => {
    const p = defs
      .append("pattern")
      .attr("id", ((typeof id_prefix !== "undefined" && id_prefix) ? id_prefix + "_" : "") + "pattern-single-lc-" + d.lc2_id)
      .attr("width", 10)
      .attr("height", 10)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(45)");

    p.append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", d.color || "green");

    p.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 10)
      .attr("stroke", "rgba(255, 255, 255, 0.5)")
      .attr("stroke-width", 3.5);

    p.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 10)
      .attr("stroke", "rgba(0, 0, 0, 0.2)")
      .attr("stroke-width", 1);
  });

  // Append a rect for each y ticks.
  svg
    .append("g")
    .selectAll()
    .data(lc_area)
    .join("rect")
    .attr("fill", (d) =>
      d.lc1_id === d.lc2_id
        ? `url(#${(typeof id_prefix !== "undefined" && id_prefix) ? id_prefix + "_" : ""}pattern-single-lc-${d.lc2_id})`
        : d.color || "green"
    )
    .attr("stroke", "rgba(0,0,0,0.15)")
    .attr("stroke-width", "0.5")
    .attr("x", x(0))
    .attr("y", (d) => y(d.label))
    .attr("width", (d) => x(d.area) - x(0))
    .attr("height", y.bandwidth());

  // Append a label for each y ticks.
  svg
    .append("g")
    .style("font-size", "0.7em")
    .selectAll()
    .data(lc_area)
    .join("text")
    .attr("x", (d) => x(d.area))
    .attr("y", (d) => y(d.label) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("dx", (d) => (x(d.area) - x(0) < 30 ? +4 : -4))
    .attr("text-anchor", (d) => (x(d.area) - x(0) < 30 ? "start" : "end"))
    .attr("fill", (d) => (x(d.area) - x(0) < 30 ? "black" : get_contrast_color(d.color)))
    .text((d) => format(d.area));

  // Create the axes.
  svg
    .append("g")
    .attr("transform", `translate(0,${marginTop})`)
    .call(d3.axisTop(x).ticks(width / 80))
    .call((g) => g.select(".domain").remove());

  svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .style("font-size", "0.7em")
    .call(d3.axisLeft(y).tickSizeOuter(0));
  svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "start")
    .attr("x", 10)
    .attr("y", 10)
    .style("font-size", "0.9em")
    .attr("font-weight", 700)
    .text(lc_label);

  svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "start")
    .attr("x", 10)
    .attr("y", 25)
    .style("font-size", "0.8em")
    .attr("font-weight", 700)
    .text("conversion to ↓");

  svg
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", width - 10)
    .attr("y", 15)
    .style("font-size", "0.8em")
    .text("Converted area (ha)");

  return svg.node();
}

/**
 * Builds the interactive Transition Probability Matrix (TPM) modal editor dialog.
 * Enables live 2-way synchronized editing of transition area (ha) and rate (%),
 * proportional redistribution of unlocked area, locking, reset to baseline, and zero conversion.
 * @param {string|HTMLElement} div_id - Target modal dialog container element.
 * @param {Array<Object>} lc_tpm - Current transition records for the selected source land cover.
 * @param {Array<Object>|null} lc_tpm_prev - Transition records from the previous projection step.
 * @param {number} lc1_id - Source land cover ID being edited.
 * @param {Array<Object>} landcovers - Land cover metadata definitions.
 * @param {string} [period=""] - Formatted period label.
 * @param {boolean} [disable=false] - If true, displays in read-only mode.
 * @param {string} LIB_PATH - Path to icon assets.
 * @param {Function} add_row_tpm - Callback to append a newly added destination category.
 * @param {Function} update_lc_edit - Callback to push modified transition records back to parent state.
 * @returns {Object} Interface object exposing select_input and cancel methods.
 */
function edit_tpm(
  div_id,
  lc_tpm,
  lc_tpm_prev,
  lc1_id,
  landcovers,
  period = "",
  disable = false,
  LIB_PATH,
  add_row_tpm,
  update_lc_edit
) {
  var lc_edited = structuredClone(lc_tpm);
  update_lc_edit(lc_edited);

  const lc_edit_default = lc_tpm_prev == null ? lc_tpm : lc_tpm_prev;
  let new_landcovers = [];

  const lc2arr = Array.from(
    d3.union(
      lc_edited.map((d) => d.lc2_id),
      lc_edit_default.map((d) => d.lc2_id)
    )
  );
  lc2arr.sort(d3.ascending);

  /**
   * Finds land cover record by ID.
   * @param {number} lc_id - Land cover ID.
   * @returns {Object|undefined} Land cover object.
   */
  function get_landcover(lc_id) {
    var lc = landcovers.find((e) => e.lc_id == lc_id);
    if (typeof lc == "undefined") {
      console.log("land cover unknown:" + lc_id);
      return "";
    }
    return lc.label;
  }

  const sum_area = d3.sum(lc_edited, (d) => d.area);
  const lc1_label = get_landcover(lc1_id);
  // Theme: danger=#9E2A2B, success=#47602B, warning=#E09F3E
  const red_bg    = "#fff2f2";   // danger light  — locked/edited rows
  const green_bg  = "#eef4f7";   // info light    — unlocked editable inputs
  const yellow_bg = "#fef4e0";   // warning light — baseline/disabled inputs
  const f = d3.format(",.0f");
  const f2 = d3.format(".2%");

  //***** Header
  d3.select(div_id).selectAll("*").remove("*");
  const p = d3.select(div_id).append("div").attr("id", "tpm_editor");

  // — Green header card —
  const hdr = p.append("div").attr("id", "tpm_header");
  hdr.append("h3").text(`Conversion of: ${lc1_label}`);
  const meta = hdr.append("div").attr("class", "tpm-meta");
  meta.append("span").attr("class", "tpm-badge").html(`<i class="fa-solid fa-calendar-days fas fa-calendar-alt"></i> ${period}`);
  meta.append("span").attr("class", "tpm-badge").html(`<i class="fa-solid fa-ruler-combined fas fa-ruler-combined"></i> ${f(sum_area)} ha total`);

  // — Toolbar (edit mode only) —
  if (!disable) {
    const tb = p.append("div").attr("id", "tpm_toolbar");
    tb.append("button")
      .attr("id", "reset_button")
      .attr("title", "Reset all transition areas to their baseline projection values")
      .html('<i class="fa-solid fa-rotate-left fas fa-undo-alt"></i> Reset all to baseline');
    tb.append("button")
      .attr("id", "noconv_button")
      .attr("title", "Keep all area in this land cover (zero conversion to other land cover types)")
      .html('<i class="fa-solid fa-ban fas fa-ban"></i> Set to no conversion');
  }

  // — Column header bar —
  const colhdr = p.append("div").attr("id", "tpm_col_headers");
  colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-lc").text("Land Cover");
  if (!disable) {
    colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-def").text("Baseline");
    colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-dpct").text("%");
    colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-arr").text("");
  }
  colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-edit").text("Area (ha)");
  colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-pct").text("%");
  if (!disable) {
    colhdr.append("div").attr("class", "tpm-col-hdr tpm-col-hdr-lock").attr("title", "Lock / unlock transitions").html('<i class="fa-solid fa-lock fas fa-lock"></i>');
  }

  //****** Row content
  /**
   * Finds baseline default transition record for a destination category.
   * @param {number} lc2_id - Destination land cover ID.
   * @returns {Object} Default record with area and r.
   */
  function find_def(lc2_id) {
    let a = lc_edit_default.find((d) => d.lc2_id == lc2_id);
    if (typeof a == "undefined") a = { area: 0, r: 0 };
    return a;
  }

  /**
   * Creates a new blank transition record for a newly added destination category.
   * @param {number} lc2_id - Destination land cover ID.
   * @returns {Object} Initialized transition object.
   */
  function get_new_lc(lc2_id) {
    return {
      iteration: lc_edited[0].iteration,
      zone_id: lc_edited[0].zone_id,
      lc1_id: lc1_id,
      lc2_id: lc2_id,
      area: 0,
      r: 0,
      lock: false
    };
  }

  /**
   * Finds or creates an edited transition record for a destination category.
   * @param {number} lc2_id - Destination land cover ID.
   * @returns {Object} Active edit record.
   */
  function find_edit(lc2_id) {
    let a = lc_edited.find((d) => d.lc2_id == lc2_id);
    if (typeof a == "undefined") {
      console.log("find edit null:" + lc2_id);
      lc_edited.push(get_new_lc(lc2_id));
      a = lc_edited.find((d) => d.lc2_id == lc2_id);
    }
    return a;
  }

  const row_content = p.append("div").attr("id", "tpm_list");
  add_rows(row_content, lc2arr);

  /**
   * Renders rows in the TPM conversion editor list with editable area and rate inputs.
   * @param {d3.Selection} div_el - Parent container selection.
   * @param {Array<number>} data_arr - Array of destination land cover IDs (lc2_id).
   */
  function add_rows(div_el, data_arr) {
    const row = div_el.selectAll().data(data_arr).enter().append("div").attr("class", (d) => "tpm_row" + (find_edit(d).lock ? " tpm_row_edited" : ""));
    // Land cover label with color dot
    const lclab = row.append("div").attr("class", "lc_label");
    lclab.append("span").attr("class", "lc-dot")
      .style("background", (d) => { const lc = landcovers.find(e => e.lc_id == d); return lc && lc.color ? lc.color : "#40916c"; });
    lclab.append("span").attr("class", "lc-name").text((d) => get_landcover(d));
    if (!disable) {
      row
        .append("div")
        .attr("class", "lc_def def_area")
        .attr("id", (d) => "def_a_lc_inp_" + d)
        .text((d) => f(find_def(d).area));
      row
        .append("div")
        .attr("class", "lc_def def_ratio")
        .attr("id", (d) => "def_r_lc_inp_" + d)
        .text((d) => f2(find_def(d).r));
      row
        .append("button")
        .attr("class", "def_button")
        .attr("id", (d) => "def_x_lc_inp_" + d)
        .attr("title", "Copy baseline value")
        .html('<i class="fa-solid fa-arrow-right fas fa-arrow-right"></i>');
    }
    row
      .append("input")
      .attr("class", "inp_lc_area")
      .attr("id", (d) => "lc_inp_" + d)
      .attr("value", (d) => f(find_edit(d).area))
      .property("value", (d) => f(find_edit(d).area))
      .on("focus", focusValue)
      .on("blur", blurValue)
      .on("input", inputValue)
      .on("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.target.blur();
        }
      });
    row
      .append("input")
      .attr("class", "inp_lc_area_ratio")
      .attr("id", (d) => "r_lc_inp_" + d)
      .attr("value", (d) => f2(find_edit(d).r))
      .property("value", (d) => f2(find_edit(d).r))
      .on("focus", focusRate)
      .on("blur", blurRate)
      .on("input", inputRate)
      .on("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.target.blur();
        }
      });

    if (!disable) {
      const locklab = row.append("label").attr("class", "inp_lock_label").attr("title", "Lock / unlock transition");
      locklab
        .append("input")
        .attr("class", "inp_lock")
        .attr("id", (d) => "cb_lc_inp_" + d)
        .attr("type", "checkbox")
        .property("checked", (d) => find_edit(d).lock)
        .on("click", updateLock);

      locklab
        .append("i")
        .attr("class", "fa-solid fa-lock-open fas fa-lock-open fa-lock-open-icon");
      locklab
        .append("i")
        .attr("class", "fa-solid fa-lock fas fa-lock fa-lock-checked-icon");
    }
  }
  // — Add land cover footer —
  if (!disable) {
    const lc_avail = landcovers.filter((d) => !lc2arr.includes(d.lc_id));
    const footer = p.append("div").attr("id", "tpm_add_row");
    const sel = footer.append("select").attr("id", "tpm_add_select");
    sel.append("option").attr("value", "").attr("disabled", true).property("selected", true).text("— select land cover to add —");
    sel.selectAll("option.lc-opt")
      .data(lc_avail).enter()
      .append("option").attr("class", "lc-opt")
      .attr("value", (d) => d.lc_id)
      .text((d) => d.label);
    footer.append("button").attr("id", "tpm_add_btn").html('<i class="fa-solid fa-plus fas fa-plus"></i> Add');
    document.getElementById("tpm_add_btn").addEventListener("click", () => {
      const v = document.getElementById("tpm_add_select").value;
      if (!v) return;
      add_lc(Number(v));
      // remove from select options
      const opt = document.querySelector(`#tpm_add_select option[value="${v}"]`);
      if (opt) opt.remove();
      document.getElementById("tpm_add_select").value = "";
    });
  }

  /**
   * Adds a new conversion destination category to the current transition list.
   * @param {number} lc2_id - Destination land cover ID.
   */
  function add_lc(lc2_id) {
    const new_lc = get_new_lc(lc2_id);
    add_row_tpm(new_lc);
    const tlist = d3.select("#tpm_list");
    add_rows(tlist, [lc2_id]);
  }

  d3.select("#reset_button").on("click", reset_todefault);
  d3.selectAll(".def_button").on("click", set_todefault);
  d3.select("#noconv_button").on("click", set_no_conversion);

  lc_edited
    .filter((d) => d.lock)
    .forEach((d) => set_input_bg(d.lc2_id, red_bg));

  if (disable) {
    d3.selectAll(".inp_lc_area")
      .attr("disabled", "true")
      .style("background", yellow_bg)
      .style("border-color", "#f5c842");
    d3.selectAll(".inp_lc_area_ratio")
      .attr("disabled", "true")
      .style("background", yellow_bg)
      .style("border-color", "#f5c842")
      .style("color", "#888");
  }

  /**
   * Resets all transition rows back to their baseline default values.
   * @param {Event} e - Button click event.
   */
  function reset_todefault(e) {
    lc_edit_default.forEach((d) => {
      let o = lc_edited.find((f) => f.lc2_id === d.lc2_id);
      o.area = d.area;
      o.r = d.r;
      const aInp = document.querySelector("#lc_inp_" + d.lc2_id);
      const rInp = document.querySelector("#r_lc_inp_" + d.lc2_id);
      if (aInp) aInp.value = f(d.area);
      if (rInp) rInp.value = f2(d.r);
    });
  }

  /**
   * Resets a single transition row back to its baseline default value.
   * @param {Event} e - Row button click event.
   */
  function set_todefault(e) {
    const id = Number(e.target.id.replace("def_x_lc_inp_", ""));
    const el = get_input_element(id);
    const v = lc_edit_default.find((e) => e.lc2_id === id).area;
    updateValue(el, v);
    if (el.element) el.element.value = f(el.edit.area);
    const rEl = document.querySelector("#r_lc_inp_" + id);
    if (rEl) rEl.value = f2(el.edit.r);
  }

  /**
   * Sets all area to persist in the source land cover (zero conversion to other types).
   * @param {Event} e - Button click event.
   */
  function set_no_conversion(e) {
    const o = lc_edited.filter((d) => d.lock);
    o.forEach((d) => {
      if (d.lc2_id == lc1_id) return;
      d.lock = false;
      const cb = document.querySelector("#cb_lc_inp_" + d.lc2_id);
      if (cb) cb.checked = false;
      set_input_bg(d.lc2_id, green_bg);
    });
    const el = get_input_element(lc1_id);
    updateValue(el, sum_area);
  }

  /**
   * Toggles the manual edit lock state on a transition row.
   * @param {Event} e - Lock button click event.
   */
  function updateLock(e) {
    if (e.target.checked) {
      const inp_lock = d3.selectAll(".inp_lock");
      if (d3.every(inp_lock, (d) => d.checked)) {
        e.target.checked = false;
        return;
      }
    }
    const id = Number(e.target.id.replace("cb_lc_inp_", ""));
    const lc = lc_edited.find((d) => d.lc2_id === id);
    lc.lock = e.target.checked;
    set_input_bg(id, e.target.checked ? red_bg : green_bg);
    if (!e.target.checked) update_unlocked_area();
  }

  /**
   * Updates input background color based on lock/edit status.
   * @param {number} id - Destination land cover ID.
   * @param {string} c - CSS color string.
   */
  function set_input_bg(id, c) {
    const a1 = document.querySelector("#" + "lc_inp_" + id);
    const a2 = document.querySelector("#" + "r_lc_inp_" + id);
    const bColor = c === red_bg ? "#9E2A2B" : "#89adb7";
    if (a1) {
      a1.style.backgroundColor = c;
      a1.style.borderColor = bColor;
    }
    if (a2) {
      a2.style.backgroundColor = c;
      a2.style.borderColor = bColor;
    }
  }

  /**
   * Gets the HTMLInputElement for area input of a specific destination ID.
   * @param {number} id - Destination land cover ID.
   * @returns {HTMLInputElement|null} Input element.
   */
  function get_input_element(id) {
    const inp = document.querySelector("#" + "lc_inp_" + id);
    const o = find_edit(id);
    return { id: id, element: inp, edit: o };
  }

  /**
   * Selects all text when area input receives focus.
   * @param {FocusEvent} e - Focus event.
   */
  function focusValue(e) {
    const id = Number(e.target.id.replace("lc_inp_", ""));
    const el = get_input_element(id);
    el.element.value = el.edit.area;
    el.element.select();
  }

  /**
   * Formats and validates area input on blur, distributing remaining area to unlocked rows.
   * @param {FocusEvent} e - Blur event.
   */
  function blurValue(e) {
    const id = Number(e.target.id.replace("lc_inp_", ""));
    const el = get_input_element(id);
    let v = el.element.value;
    const fc = v.slice(0, 1);
    if (fc == "+" || fc == "-") {
      const def = lc_edit_default.find((e) => e.lc2_id === id) || { area: 0, r: 0 };
      const plus = v.slice(1);
      if (plus.slice(-1) == "%") {
        const r = Math.abs(Number(plus.slice(0, -1)));
        if (isNaN(r) || r > 100) {
          v = el.edit.area;
        } else {
          if (fc == "+") {
            v = (sum_area * (def.r + r / 100)).toString();
          } else if (fc == "-") {
            v = (sum_area * Math.max(0, def.r - r / 100)).toString();
          }
        }
      } else {
        if (fc == "+") {
          v = def.area + Number(plus);
        } else if (fc == "-") {
          v = Math.max(0, def.area - Number(plus));
        }
      }
    }
    updateValue(el, Math.abs(Number(v)));
    const aInp = document.querySelector("#lc_inp_" + id);
    const rInp = document.querySelector("#r_lc_inp_" + id);
    if (aInp) aInp.value = f(el.edit.area);
    if (rInp) rInp.value = f2(el.edit.r);
  }

  /**
   * Live validation handler for area input as user types.
   * @param {InputEvent} e - Input event.
   */
  function inputValue(e) {
    const id = Number(e.target.id.replace("lc_inp_", ""));
    const el = get_input_element(id);
    let v = el.element.value.trim();
    const fc = v.slice(0, 1);
    if (fc == "+" || fc == "-") return;
    if (v.slice(-1) == "%") {
      const r = Math.abs(Number(v.slice(0, -1)));
      if (isNaN(r) || r > 100) {
        v = el.edit.area;
      } else {
        v = ((sum_area * r) / 100).toString();
      }
      updateValue(el, Math.abs(Number(v)));
      return;
    }
    if (v.slice(-1) == ".") {
      return;
    }
    if (v === "" || isNaN(Number(v))) return;
    if (Number(v) <= 100) {
      return;
    }
    updateValue(el, Math.abs(Number(v)));
  }

  /**
   * Selects text when rate (%) input receives focus.
   * @param {FocusEvent} e - Focus event.
   */
  function focusRate(e) {
    const id = Number(e.target.id.replace("r_lc_inp_", ""));
    const el = get_input_element(id);
    const pct = Math.round(el.edit.r * 10000) / 100;
    e.target.value = pct.toString();
    e.target.select();
  }

  /**
   * Parses and validates percentage rate string, clamping between 0% and 100%.
   * @param {string} valStr - Raw input string (e.g. "25%", "0.25", "25").
   * @param {number} id - Destination land cover ID.
   * @returns {number|null} Validated rate between 0 and 1, or null if invalid.
   */
  function parseRateInput(valStr, id) {
    if (typeof valStr !== "string") valStr = String(valStr);
    valStr = valStr.trim();
    if (valStr === "") return null;
    const def = lc_edit_default.find((e) => e.lc2_id === id) || { area: 0, r: 0 };
    const fc = valStr.slice(0, 1);
    if (fc === "+" || fc === "-") {
      let numStr = valStr.slice(1).replace("%", "").trim();
      let deltaPct = Number(numStr);
      if (isNaN(deltaPct)) return null;
      let targetRate = fc === "+" ? (def.r + deltaPct / 100) : (def.r - deltaPct / 100);
      return Math.max(0, Math.min(1, targetRate));
    }
    let numStr = valStr.replace("%", "").trim();
    let pct = Number(numStr);
    if (isNaN(pct)) return null;
    let targetRate = pct / 100;
    return Math.max(0, Math.min(1, targetRate));
  }

  /**
   * Formats and validates rate (%) input on blur, recomputing area and distributing remaining area.
   * @param {FocusEvent} e - Blur event.
   */
  function blurRate(e) {
    const id = Number(e.target.id.replace("r_lc_inp_", ""));
    const el = get_input_element(id);
    const targetRate = parseRateInput(e.target.value, id);
    if (targetRate === null) {
      e.target.value = f2(el.edit.r);
      return;
    }
    const targetArea = Math.round(targetRate * sum_area);
    updateValue(el, targetArea);
    const aInp = document.querySelector("#lc_inp_" + id);
    const rInp = document.querySelector("#r_lc_inp_" + id);
    if (aInp) aInp.value = f(el.edit.area);
    if (rInp) rInp.value = f2(el.edit.r);
  }

  /**
   * Live validation handler for rate (%) input as user types.
   * @param {InputEvent} e - Input event.
   */
  function inputRate(e) {
    const id = Number(e.target.id.replace("r_lc_inp_", ""));
    const el = get_input_element(id);
    let valStr = e.target.value.trim();
    if (valStr === "") return;
    const fc = valStr.slice(0, 1);
    if (fc === "+" || fc === "-") {
      let numStr = valStr.slice(1).replace("%", "").trim();
      if (numStr === "" || isNaN(Number(numStr))) return;
    } else {
      if (valStr.slice(-1) === ".") return;
      let numStr = valStr.replace("%", "").trim();
      if (numStr === "" || isNaN(Number(numStr))) return;
    }

    const targetRate = parseRateInput(valStr, id);
    if (targetRate === null || isNaN(targetRate)) return;

    const targetArea = Math.round(targetRate * sum_area);
    updateValue(el, targetArea);
  }

  /**
   * Updates row area value, locks row, and redistributes remainder to unlocked categories.
   * @param {HTMLInputElement} el - Triggering input element.
   * @param {number} v - New area value in hectares.
   */
  function updateValue(el, v) {
    const inp_lock = d3.selectAll(".inp_lock");
    if (isNaN(v)) v = el.edit.area;
    if (v !== el.edit.area) {
      let lock = document.querySelector("#" + "cb_lc_inp_" + el.id);
      if (lock) lock.checked = true;
      // at least one lc should be unlocked
      if (d3.every(inp_lock, (d) => d.checked)) {
        if (lock) lock.checked = false;
        if (el.element && document.activeElement !== el.element) {
          el.element.value = f(el.edit.area);
        }
        const rEl = document.querySelector("#r_lc_inp_" + el.id);
        if (rEl && document.activeElement !== rEl) {
          rEl.value = f2(el.edit.r);
        }
        return;
      }

      set_input_bg(el.id, red_bg);
      el.edit.lock = true;
      el.edit.area = 0;

      const lock_a = d3.sum(lc_edited, (d) => (d.lock ? d.area : 0));
      let remain_a = sum_area - lock_a - v;
      if (remain_a < 0) {
        v = sum_area - lock_a;
        remain_a = 0;
      }
      el.edit.area = v;
      el.edit.r = sum_area > 0 ? v / sum_area : 0;
      update_unlocked_area();
    }
    // Only update inputs that are NOT currently being typed in by the user
    if (el.element && document.activeElement !== el.element) {
      el.element.value = f(el.edit.area);
    }
    const rEl = document.querySelector("#r_lc_inp_" + el.id);
    if (rEl && document.activeElement !== rEl) {
      rEl.value = f2(el.edit.r);
    }
    update_lc_edit(lc_edited);
  }

  /**
   * Retrieves baseline default area for a destination category.
   * @param {number} lc2_id - Destination land cover ID.
   * @returns {number} Default area in hectares.
   */
  function get_default_area(lc2_id) {
    const def = lc_edit_default.find((e) => e.lc2_id === lc2_id); //.area
    if (typeof def == "undefined") return 0;
    return def.area;
  }

  /**
   * Proportionally redistributes remaining unallocated area among unlocked transition rows.
   */
  function update_unlocked_area() {
    // the remaining area will be shared proporsionally based on default (unlocked) tpm
    const lock_a = d3.sum(lc_edited, (d) => (d.lock ? d.area : 0));
    let remain_a = sum_area - lock_a;
    const edit_a = d3.sum(lc_edited, (d) =>
      d.lock ? 0 : get_default_area(d.lc2_id)
    );
    lc_edited.forEach((d) => {
      if (!d.lock) {
        if (edit_a == get_default_area(d.lc2_id)) {
          d.area = remain_a;
        } else {
          d.area = edit_a > 0 ? (remain_a * get_default_area(d.lc2_id)) / edit_a : 0;
        }
      }
      d.r = sum_area > 0 ? d.area / sum_area : 0;
      const aInp = document.querySelector("#lc_inp_" + d.lc2_id);
      const rInp = document.querySelector("#r_lc_inp_" + d.lc2_id);
      if (aInp && document.activeElement !== aInp) aInp.value = f(d.area);
      if (rInp && document.activeElement !== rInp) rInp.value = f2(d.r);
    });
  }
}

/**
 * Focuses and selects the input element for a specified land cover ID.
 * @param {number} lc_id - Land cover ID.
 */
function selectInput(lc_id) {
  if (typeof lc_id === "undefined") return;
  const input = document.querySelector("#lc_inp_" + lc_id);
  input.focus();
  input.select();
}

/**
 * Renders a stacked area chart showing land cover dynamics over projection steps or historical periods.
 * Supports interactive period selection and hover tooltips showing individual trajectories.
 * @param {string|HTMLElement} div_id - Target container.
 * @param {Array<Object>} bs_area - Baseline area records across iterations.
 * @param {Array<Object>} sc_area - Scenario area records across iterations.
 * @param {Array<Object>} landcover - Land cover metadata definitions.
 * @param {number} [selected_period=0] - Currently selected iteration period index.
 * @param {Function} get_iteration_year - Formatter mapping iteration index to calendar year.
 * @param {Function|null} [click_period=null] - Period selection click callback.
 */
function render_lc_projection_area(
  div_id,
  bs_area,
  sc_area,
  landcover,
  selected_period = 0,
  get_iteration_year,
  click_period = null,
  show_period_selection = false,
  width = 300,
  zone_name = null,
  height = null,
  available_years = null
) {
  // Specify the chart’s dimensions.

  const container = typeof div_id === "string" ? document.querySelector(div_id) : div_id;
  const chart_uid = (typeof div_id === "string" ? div_id.replace(/[^a-zA-Z0-9_-]/g, "") : (container && container.id ? container.id : "")) || ("chart_" + Math.floor(Math.random() * 1000000));
  const is_observed = available_years && Array.isArray(available_years) && available_years.length > 0;
  const containerHeight = (container && container.clientHeight > 50) ? container.clientHeight : null;
  const containerWidth = (container && container.clientWidth > 50) ? container.clientWidth : null;
  height = (height && height > 50) ? height : (containerHeight || 280);
  width = (width && width > 50) ? width : (containerWidth || 300);
  const marginTop = 8;
  const marginRight = 20;
  const marginBottom = show_period_selection ? 45 : 30;
  const marginLeft = 30;

  const n_iteration = d3.max(bs_area.map((d) => d.iteration));
  let line_data = sc_area.filter((d) => d.lc1_id == 0);

  // Determine the series that need to be stacked.
  const series = d3
    .stack()
    .keys(d3.union(sc_area.map((d) => d.lc1_id))) // distinct series keys, in input order
    .value(([, D], key) =>
      typeof D.get(key) === "undefined" ? 0 : D.get(key).area
    )(
    d3.index(
      sc_area,
      (d) => d.iteration,
      (d) => d.lc1_id
    )
  ); // group by stack then series key

  // Prepare the scales for positional and color encodings.
  const x = d3
    .scaleLinear()
    .domain(d3.extent(sc_area, (d) => d.iteration))
    .range([marginLeft, width - marginRight]);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(series, (d) => d3.max(d, (d) => d[1])) || 0])
    .rangeRound([height - marginBottom, marginTop]);

  const color = d3
    .scaleOrdinal()
    .domain(series.map((d) => d.key))
    .range(d3.schemeTableau10);

  /**
   * Returns assigned color hex for a land cover ID in projection area chart.
   * @param {number} lc_id - Land cover ID.
   * @returns {string} Hex color string.
   */
  function get_color(lc_id) {
    lc = landcover.find((d) => d.lc_id == lc_id);
    if (lc) return lc.color;
    return "gray";
  }
  // Construct an area shape.
  const area = d3
    .area()
    .x((d) => x(d.data[0]))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]));

  // Create the SVG container.
  d3.select(div_id).selectAll("*").remove();
  const svg = d3
    .select(div_id)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "width: 100%; height: 100%; display: block; overflow: visible;");

  // Add the y-axis, remove the domain line, add grid lines and a label.
  svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(d3.axisLeft(y).ticks(height / 50, "s"))
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .selectAll(".tick line")
        .clone()
        .attr("x2", width - marginLeft - marginRight)
        .attr("stroke-opacity", 0.1)
    );

  // Append a path for each series.
  svg
    .append("g")
    .selectAll()
    .data(series)
    .join("path")
    .attr("fill", (d) => get_color(d.key))
    .attr("d", area)
    .on("pointerenter pointermove", pointermoved_y)
    .on("pointerleave", pointerleft_y)
    .on("click", (show_period_selection && !is_observed) ? clicked : null)
    .append("title")
    .text((d) => get_lc_label(d.key));
  let axisBottom = d3.axisBottom(x).tickSizeOuter(0);
  if (available_years && Array.isArray(available_years) && available_years.length > 0) {
    axisBottom = axisBottom
      .tickValues(available_years)
      .tickFormat(d3.format("d"));
  } else {
    axisBottom = axisBottom
      .ticks(n_iteration + 1)
      .tickFormat((d) => get_iteration_year(d));
  }

  const xaxis = svg
    .append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(axisBottom);

  if (show_period_selection && !is_observed) {
    svg
      .on("pointerenter pointermove", pointermoved_x)
      .on("pointerleave", pointerleft_x)
      .on("click", clicked);
  }

  


  const markerBoxWidth = 3;
  const markerBoxHeight = 3;
  const arrowPoints = [
    [0, 0],
    [0, 3],
    [3, 1.5],
  ];

  /**
   * Dynamically defines an SVG arrow marker for tooltip connector lines.
   * @param {string} color - Marker color.
   * @returns {string} SVG url reference string.
   */
  function define_arrow_marker(color) {
    const safeColor = String(color).replace(/[^a-zA-Z0-9_-]/g, "");
    const id = chart_uid + "_arrow_" + safeColor;
    svg
      .append("defs")
      .append("marker")
      .attr("id", id)
      .attr("viewBox", [0, 0, markerBoxWidth, markerBoxHeight])
      .attr("refX", markerBoxWidth / 2)
      .attr("refY", markerBoxHeight / 2)
      .attr("markerWidth", markerBoxWidth)
      .attr("markerHeight", markerBoxHeight)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 0 " + markerBoxHeight + " L " + markerBoxWidth + " " + (markerBoxHeight / 2) + " z")
      .attr("fill", color);
    return "url(#" + id + ")";
  }

  /**
   * Appends an SVG line element equipped with an arrow marker.
   * @param {string} color - Line stroke color.
   * @returns {d3.Selection} Appended D3 line selection.
   */
  function define_line(color) {
    const arrow = define_arrow_marker(color);
    const line = svg
      .append("line")
      .attr("x1", 0)
      .attr("y1", height - 20)
      .attr("x2", 0)
      .attr("y2", height - 20)
      .style("stroke", color)
      .attr("stroke-width", 3)
      .attr("fill", color)
      .attr("marker-start", arrow)
      .attr("marker-end", arrow);
    return line;
  }

  const line = define_line("lightgray").style("display", "none");
  const selected_line = define_line("black").style(
    "display",
    (show_period_selection && !is_observed) ? null : "none"
  );

  /**
   * Appends an SVG rect element used for tooltip backing panels.
   * @param {string} color - Fill color.
   * @returns {d3.Selection} Appended D3 rect selection.
   */
  function define_rect(color) {
    const rect = svg
      .append("rect")
      .attr("x", 0)
      .attr("y", marginTop)
      .attr("width", x(1) - x(0))
      .attr("height", height - marginTop - marginBottom)
      .style("pointer-events", "none")
      .style("opacity", 0.3)

      .style("fill", color);
    return rect;
  }

  const rect = define_rect("white").style("display", "none");
  const selected_rect = define_rect("black").style(
    "display",
    (show_period_selection && !is_observed) ? null : "none"
  );

  /**
   * Returns display label for a land cover ID in projection area chart.
   * @param {number} lc_id - Land cover ID.
   * @returns {string} Display label.
   */
  function get_lc_label(lc_id) {
    const lc = landcover.find((o) => o.lc_id == lc_id);
    if (typeof lc == "undefined") return "";
    return lc.label;
  }

  const tooltip = d3
    .select(div_id)
    .append("div")
    .attr("id", "tooltip_area")
    .style("display", "none")
    .style("min-height", "105px");

  const filter_id = chart_uid + "_tooltip_connector_shadow";
  const arrow_id = chart_uid + "_tooltip_connector_arrow";

  const tooltip_connector_shadow = svg
    .append("defs")
    .append("filter")
    .attr("id", filter_id)
    .attr("x", "-50%")
    .attr("y", "-50%")
    .attr("width", "200%")
    .attr("height", "200%")
    .append("feDropShadow")
    .attr("dx", 2)
    .attr("dy", 2)
    .attr("stdDeviation", 2)
    .attr("flood-color", "black")
    .attr("flood-opacity", 0.4);

  const tooltip_arrow = svg
    .append("defs")
    .append("marker")
    .attr("id", arrow_id)
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 8)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "white")
    .attr("filter", "url(#" + filter_id + ")");

  const tooltip_connector = svg
    .append("line")
    .attr("class", "tooltip_connector")
    .style("display", "none")
    .attr("stroke", "white")
    .attr("filter", "url(#" + filter_id + ")")
    .attr("stroke-width", 3)
    .attr("stroke-dasharray", "4 3")
    .attr("marker-end", "url(#" + arrow_id + ")")
    .attr("pointer-events", "none");
  const tooltip_anchor_period = 0;

  /**
   * Updates dynamic connector arrow and text tooltip for the hovered land cover layer.
   * @param {Object} series_data - Active series data point.
   */
  function update_tooltip_connector(series_data) {
    const anchor_period = is_observed ? available_years[0] : 0;
    const next_period = is_observed ? (available_years[1] || available_years[0]) : 1;
    const svg_rect = svg.node().getBoundingClientRect();
    const tooltip_rect = tooltip.node().getBoundingClientRect();
    const scale_x = width / svg_rect.width;
    const scale_y = height / svg_rect.height;
    const highlighted_point = series_data.find(
      (point) => point.data[0] == anchor_period
    );
    const target_x = (x(anchor_period) + x(next_period)) / 2;
    const target_y = highlighted_point
      ? y((highlighted_point[0] + highlighted_point[1]) / 2)
      : height - marginBottom;
    const tooltip_x = Math.max(
      0,
      Math.min(width, (tooltip_rect.left - svg_rect.left) * scale_x)
    );
    const tooltip_y = Math.max(
      0,
      Math.min(
        height,
        ((tooltip_rect.top + tooltip_rect.height / 2) - svg_rect.top) * scale_y
      )
    );
    tooltip_connector
      .attr("x1", target_x)
      .attr("y1", target_y)
      .attr("x2", tooltip_x)
      .attr("y2", tooltip_y)
      .style("display", null);
  }

  /**
   * Handles pointer leave from stacked area path in projection area chart, hiding connector and tooltip.
   * @param {PointerEvent} event - Pointer event.
   * @param {Object} edata - Series data.
   */
  function pointerleft_y(event, edata) {
    tooltip.style("display", "none");
    tooltip_connector.style("display", "none");
    line.style("display", "none");
    rect.style("display", "none");
    event.target.setAttribute("stroke", null);
  }

  /**
   * Handles pointer move over stacked area layer in projection area chart, displaying preview line plot.
   * @param {PointerEvent} event - Pointer event.
   * @param {Object} edata - Series data.
   */
  function pointermoved_y(event, edata) {
    tooltip.style("display", null);
    line_data = sc_area.filter((d) => d.lc1_id == edata.key);
    const line_data_base = bs_area.filter((d) => d.lc1_id == edata.key);

    // Make popup chart dynamically scale with main chart size
    const pop_width = Math.max(180, Math.min(320, Math.round(width * 0.28)));
    const pop_height = Math.max(115, Math.min(185, Math.round(pop_width * 0.58)));
    tooltip.style("width", (pop_width + 18) + "px");

    line_plot_area(
      tooltip.node(),
      line_data_base,
      line_data,
      get_iteration_year,
      get_lc_label(edata.key),
      get_color(edata.key),
      pop_width,
      pop_height,
      is_observed
    );
    update_tooltip_connector(edata);
    event.target.setAttribute("stroke", "black");
    if (show_period_selection && !is_observed) {
      pointermoved_x(event);
    }
  }

  /**
   * Handles pointer leave from X-axis period selection area.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerleft_x(event) {
    line.style("display", "none");
    rect.style("display", "none");
  }

  /**
   * Handles pointer move over X-axis period selection area, highlighting closest period.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointermoved_x(event) {
    if (!show_period_selection || is_observed) return;
    const c = x.invert(d3.pointer(event)[0]);
    const x1 = Math.floor(c);
    const x2 = Math.ceil(c);
    if(x1 < 0 || x1 > n_iteration-1) {
      pointerleft_x(event);
      return;
    }
    line.style("display", null);
    if(selected_period == x1) {
      rect.style("display", "none");
    } else {
      rect.style("display", null);
    }
    line.attr("x1", x(x1)+markerBoxWidth).attr("x2", x(x2)-markerBoxWidth);
    rect.attr("x", x(x1));
  }

  if (show_period_selection && !is_observed) {
    set_selection(selected_period);
  }

  /**
   * Updates visual position of the period selector indicator.
   * @param {number} period - Selected period index.
   */
  function set_selection(period) {
    if (!show_period_selection || is_observed) return;
    selected_period = period;
    selected_line
      .attr("x1", x(period) + markerBoxWidth)
      .attr("x2", x(period + 1) - markerBoxWidth);
    selected_rect.attr("x", x(period));
    const addt = period == 0 ? " [baseline]" : "";
  }

  // Dot markers hidden in actual data mode

  /**
   * Handles click on area chart, triggering period selection callback.
   * @param {MouseEvent} event - Click event.
   */
  function clicked(event) {
    const c = x.invert(d3.pointer(event)[0]);
    const x1 = Math.floor(c);
    const x2 = Math.ceil(c);
    if (x1 >= 0 || x1 < n_iteration) {
      set_selection(x1);
      click_period(selected_period);
    }
  }
}


/**
 * Renders a compact time series line plot comparing baseline and scenario trajectories for a land cover.
 * @param {string|HTMLElement} div_id - Target container or selector.
 * @param {Array<Object>} bs_area - Baseline area records for this land cover.
 * @param {Array<Object>} sc_area - Scenario area records for this land cover.
 * @param {Function} get_iteration_year - Formatter mapping iteration index to calendar year.
 * @param {string} lc_label - Land cover label.
 * @param {string} lc_color - Accent color hex string.
 * @param {number} [width=150] - Plot width.
 * @returns {SVGElement} Rendered D3 SVG element.
 */
function line_plot_area(
  div_id,
  bs_area,
  sc_area,
  get_iteration_year,
  lc_label,
  lc_color,
  width = 150,
  height = 100,
  is_actual = false
) {
  const marginTop = 18;
  const marginRight = 10;
  const marginBottom = 20;
  const marginLeft = 38;

  // Extract distinct sorted iterations/years to avoid tick explosion
  const iters = Array.from(new Set((is_actual ? sc_area : bs_area.concat(sc_area)).map((d) => d.iteration))).sort((a, b) => a - b);
  const xExtent = d3.extent(iters);
  const x = d3
    .scaleLinear()
    .domain(xExtent[0] === xExtent[1] ? [xExtent[0] - 1, xExtent[1] + 1] : xExtent)
    .range([marginLeft, width - marginRight]);

  const allAreas = (is_actual ? sc_area : bs_area.concat(sc_area)).map((d) => +d.area);
  const yExtent = d3.extent(allAreas);
  let yMin = yExtent[0] || 0;
  let yMax = yExtent[1] || 0;
  if (yMin === yMax) {
    yMin = yMin > 0 ? yMin * 0.9 : 0;
    yMax = yMax > 0 ? yMax * 1.1 : 1;
  }

  const y = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .rangeRound([height - marginBottom, marginTop]);

  const line = d3
    .line()
    .x((d) => x(d.iteration))
    .y((d) => y(d.area));

  const target = (typeof div_id === "string") ? d3.select(div_id) : d3.select(div_id);
  target.selectAll("*").remove();

  const svg = target
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "width: " + width + "px; height: " + height + "px; font-size: 0.65em; display: block; overflow: visible;");

  // Y-axis with light grid lines
  svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(d3.axisLeft(y).ticks(Math.max(3, Math.round(height / 35)), "s"))
    .call((g) =>
      g
        .selectAll(".tick line")
        .clone()
        .attr("x2", width - marginLeft - marginRight)
        .attr("stroke-opacity", 0.1)
    );

  // X-axis: explicit tickValues matching only the available iterations/years (no mesh!)
  let axisBottom = d3.axisBottom(x).tickSizeOuter(0);
  if (iters.length > 0) {
    axisBottom = axisBottom
      .tickValues(iters)
      .tickFormat((d) => (is_actual ? d : get_iteration_year(d)));
  }

  svg
    .append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(axisBottom);

  if (is_actual) {
    // Actual data mode: single colored curve matching landcover color, plus data dots
    const strokeColor = lc_color || "#333";
    svg
      .append("path")
      .attr("fill", "none")
      .attr("stroke", strokeColor)
      .attr("stroke-width", 2)
      .attr("d", line(sc_area));

    svg
      .selectAll(null)
      .data(sc_area)
      .join("circle")
      .attr("cx", (d) => x(d.iteration))
      .attr("cy", (d) => y(d.area))
      .attr("r", 3)
      .attr("fill", strokeColor)
      .attr("stroke", "white")
      .attr("stroke-width", 1);
    // Legend is hidden in actual data mode as requested
  } else {
    // Projection mode: baseline (lightgray) and scenario (red)
    svg
      .append("path")
      .attr("fill", "none")
      .attr("stroke", "lightgray")
      .attr("stroke-width", 1.5)
      .attr("d", line(bs_area));

    svg
      .append("path")
      .attr("fill", "none")
      .attr("stroke", "red")
      .attr("stroke-width", 1.5)
      .attr("d", line(sc_area));

    // Legend for projection mode placed in bottom-right corner
    const leg_x = width - 58;
    const leg_y1 = height - 26;
    const leg_y2 = height - 16;
    svg.append("circle").attr("cx", leg_x).attr("cy", leg_y1).attr("r", 2.5).style("fill", "red");
    svg.append("circle").attr("cx", leg_x).attr("cy", leg_y2).attr("r", 2.5).style("fill", "lightgrey");

    svg.append("text").attr("x", leg_x + 5).attr("y", leg_y1).text("scenario").attr("alignment-baseline", "middle").style("fill", "grey").style("font-size", "0.9em");
    svg.append("text").attr("x", leg_x + 5).attr("y", leg_y2).text("baseline").attr("alignment-baseline", "middle").style("fill", "grey").style("font-size", "0.9em");
  }

  // Landcover class label at top-right
  svg
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", width - 4)
    .attr("y", marginTop - 4)
    .style("font-weight", "bold")
    .style("font-size", "1.05em")
    .text(lc_label);
}

/**
 * Adapter function that binds project data and renders the projection area streamgraph.
 * @param {HTMLElement|string} div_id - Container element or ID.
 * @param {Object} abacus_data - Project data.
 * @param {Object|null} [scenario=null] - Scenario data.
 * @param {number} [selected_iteration=1] - Active iteration.
 * @param {number} [selected_zone=0] - Active zone.
 * @param {boolean} [show_period_selection=false] - Period selector visibility flag.
 * @param {number} [width=700] - Container width.
 */
function render_lc_projection_chart(
  div_id,
  abacus_data,
  scenario = null,
  selected_iteration = 1,
  selected_zone = 0,
  show_period_selection = false,
  width = 700,
  updateValue = null,
  height = null
) {
  const is_observed = abacus_data.observed_areas &&
                      Array.isArray(abacus_data.observed_areas) &&
                      abacus_data.observed_areas.length > 0;

  const zone_id = selected_zone || (abacus_data.zone && abacus_data.zone.length
    ? abacus_data.zone[0].zone_id
    : 0);
  const zone_entry = (abacus_data.zone || []).find((z) => z.zone_id == zone_id) || (abacus_data.zone && abacus_data.zone.length ? abacus_data.zone[0] : null);
  const zone_name = zone_entry ? (zone_entry.label || zone_entry.zone_id) : zone_id;
  let landcover = [];
  if (abacus_data && abacus_data.landcover) {
    landcover = [...abacus_data.landcover];
  }
  if (scenario && scenario.landcover && Array.isArray(scenario.landcover)) {
    scenario.landcover.forEach((lc) => {
      const idx = landcover.findIndex((d) => d.lc_id == lc.lc_id);
      if (idx >= 0) {
        landcover[idx] = { ...landcover[idx], ...lc };
      } else {
        landcover.push(lc);
      }
    });
  }

  let bs_area, sc_area;
  let get_iteration_year;
  let available_years = null;

  if (is_observed) {
    let obs = abacus_data.observed_areas.filter((d) => d.zone_id == zone_id);
    if (obs.length === 0) {
      obs = abacus_data.observed_areas;
    }

    const years_set = new Set(obs.map((d) => +d.year || +d.iteration));
    available_years = Array.from(years_set).sort((a, b) => a - b);

    // Provide observed areas directly as sc_area without projection or interpolation
    sc_area = obs.map((d) => ({
      iteration: +d.year || +d.iteration,
      zone_id: +d.zone_id,
      lc1_id: +d.lc1_id,
      area: +d.area,
    }));
    bs_area = sc_area;

    get_iteration_year = (yr) => yr;
  } else {
    const n_iteration = Array.isArray(abacus_data.project.n_iteration)
      ? abacus_data.project.n_iteration[0]
      : abacus_data.project.n_iteration;

    let baseline;
    if (scenario && scenario.baseline_tpm && scenario.baseline_area && Array.isArray(scenario.baseline_tpm) && scenario.baseline_tpm.length > 0) {
      baseline = {
        tpm: structuredClone(scenario.baseline_tpm),
        area: structuredClone(scenario.baseline_area),
      };
    } else {
      baseline = get_baseline_data(abacus_data);
    }

    const scenario_tpm = scenario && Array.isArray(scenario.tpm)
      ? scenario.tpm
      : null;

    ensure_baseline_supports_scenario(baseline, scenario_tpm);

    const baseline_projection = iterate_projection(baseline, null, n_iteration);
    const projection = iterate_projection(baseline, scenario_tpm, n_iteration);

    bs_area = baseline_projection.lc_sum_area.filter((d) => d.zone_id == zone_id);
    sc_area = projection.lc_sum_area.filter((d) => d.zone_id == zone_id);

    get_iteration_year = (iteration) => {
      if (abacus_data.version == 1) {
        const baseyear = [
          abacus_data.project.baseyear0[0],
          abacus_data.project.baseyear1[0],
        ];
        if (iteration <= 1) return baseyear[iteration];
        return baseyear[1] + (iteration - 1) * (baseyear[1] - baseyear[0]);
      }
      const date1 = new Date(abacus_data.project.date1);
      const date2 = new Date(abacus_data.project.date2);
      const period_years = date_diff_year(date1, date2);
      return Math.round(date1.getFullYear() + period_years * iteration);
    };
  }

  render_lc_projection_area(
    div_id,
    bs_area,
    sc_area,
    landcover,
    selected_iteration,
    get_iteration_year,
    (period) => {
      if (show_period_selection && updateValue) {
        updateValue(
          "period:js_to_df",
          JSON.stringify({ iteration: period })
        );
      }
    },
    show_period_selection,
    width,
    zone_name,
    height,
    available_years
  );
}


/**
 * Adapter function that binds project data and renders the observed/historical land cover area chart.
 * @param {HTMLElement|string} div_id - Container element or ID.
 * @param {Object} abacus_data - Project data.
 * @param {Object} scenario - Scenario data.
 * @param {number} selected_iteration - Active iteration.
 * @param {number} selected_zone - Active zone.
 * @param {boolean} show_period_selection - Period selector visibility flag.
 * @param {number} width - Container width.
 */
function render_lc_area_chart(
  div_id,
  abacus_data,
  scenario,
  selected_iteration,
  selected_zone,
  show_period_selection,
  width,
  updateValue,
  height
) {
  return render_lc_projection_chart(
    div_id,
    abacus_data,
    scenario,
    selected_iteration,
    selected_zone,
    show_period_selection,
    width,
    updateValue,
    height
  );
}

if (typeof window !== "undefined") {
  window.render_lc_area_chart = render_lc_area_chart;
  window.render_lc_projection_chart = render_lc_projection_chart;
}
