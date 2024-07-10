function is_exist(v) {
  if (typeof v == "undefined") return false;
  return true;
}

function validate_area(a) {
  const precision = 1000000;
  return d3.max([0, Math.round((a + Number.EPSILON) * precision) / precision]);
}

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

function iterate_projection(baseline, scenario = null, n = 1) {
  let lc_area = baseline.area.map((d) => ({ iteration: 0, ...d }));
  let lc_sum_arr = lc_area;
  let lc_arr = null;

  // console.log(lc_area);

  function get_sc_r(def_r, iteration = 0, zone_id = 0, lc1_id = 0, lc2_id = 0) {
    if (scenario == null) return def_r;
    if (!Array.isArray(scenario)) return def_r;
    
    // console.log(scenario);
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

  function get_area(zone_id, lc1_id) {
    const a = lc_area.find((f) => f.zone_id == zone_id && f.lc1_id == lc1_id);
    if (typeof a == "undefined") return 0;
    return a.area;
  }

  for (let i = 0; i < n + 1; ++i) {
    let a_data = baseline.tpm.map((e) => {
      const r = get_sc_r(e.r, i, e.zone_id, e.lc1_id, e.lc2_id);
      return {
        iteration: i,
        zone_id: e.zone_id,
        lc1_id: e.lc1_id,
        lc2_id: e.lc2_id,
        r: r,
        area:
          // lc_area.find((f) => f.zone_id == e.zone_id && f.lc1_id == e.lc1_id)
          //   .area * r,
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

function get_carbon_emission(
  carbonstock,
  projection_data,
  other_factor = null,
  period = 0
) {
  function get_c(lc_id, zone_id = 0, iteration = 0) {
    cr = carbonstock.find(
      (d) =>
        d.lc_id == lc_id && d.zone_id == zone_id && d.iteration_id == iteration
    );

    if (typeof cr == "undefined") return null;
    return cr.c;
  }

  function get_other_e(lc_id, zone_id = 0, iteration = 0) {
    if (!other_factor) return 0;
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

function get_baseline_projection(abacus_data, iteration) {
  // let iteration,
  let b, proj, cstock, period_yr;

  // iteration = abacus_data.project.n_iteration[0];
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
      date_diff_year(abacus_data.project.date1, abacus_data.project.date2)
    ),
  };
}

function parseDate(input) {
  var parts = input.match(/(\d+)/g);
  // new Date(year, month [, date [, hours[, minutes[, seconds[, ms]]]]])
  return new Date(parts[0], parts[1] - 1, parts[2]); // months are 0-based
}

function date_diff_year(d1, d2) {
  let weeks = Math.round((d2 - d1) / (7 * 24 * 60 * 60 * 1000));
  return weeks / 52.25;
}

function show_lc_conversion(
  id_div,
  baseline_projection,
  LIB_PATH,
  updateValue,
  scenario = null,
  selected_iteration = 1,
  selected_zone = 0,
  selected_lc = 0,
  width = 700
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

  if (selected_iteration) {
    edited_period_id = selected_iteration;
  }

  if (selected_zone) {
    edited_zone_id = selected_zone;
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

  function get_iteration_year(i) {
    if (abacus_data.version == 1) {
      const p = [
        abacus_data.project.baseyear0[0],
        abacus_data.project.baseyear1[0],
      ];

      if (i <= 1) return p[i];
      return p[1] + (i - 1) * (p[1] - p[0]);
    } else if (abacus_data.version == 2) {
      return (
        abacus_data.project.date1.getFullYear() + Math.round(period_yr) * i
      );
    }
  }

  function get_period_label(i) {
    period_yr = date_diff_year(
      abacus_data.project.date1,
      abacus_data.project.date2
    );
    return get_iteration_year(i) + "-" + get_iteration_year(i + 1);
  }

  //PANEL LAYOUT
  const h = d3.select("#" + id_div);
  h.selectAll("*").remove("*");
  const cp = h.append("div").attr("id", "control_panel");
  const zs = cp.append("div").attr("id", "zone_selector");
  cp.append("div").attr("id", "lc_area_chart").style("width", "100%");
  h.append("div").attr("id", "lc_chart");

  //input number of iteration
  zs.append("span").text("Number of iteration:").style("margin-right", "5px");
  zs.append("input")
    .attr("id", "n_iteration")
    .style("width", "40px")
    .attr("value", n_iteration)
    .attr("type", "number")
    .attr("min", "1")
    .attr("max", "50")
    .on("blur", () =>
      update_n_iteration(d3.select("#n_iteration").property("value"))
    );

  //zone selection
  if (abacus_data.zone) {
    zs.append("label")
      .attr("for", "zone")
      .text("Select zone:")
      .style("margin-left", "50px");
    const zmenu = zs
      .append("select")
      .style("height", "30px")
      .attr("name", "zone")
      .attr("id", "zone")
      .on("change", () =>
        select_zone(Number(d3.select("#zone").property("value")))
      );
    zmenu
      .selectAll("option")
      .data(abacus_data.zone)
      .enter()
      .append("option")
      .text((d) => d.label)
      .attr("value", (d) => d.zone_id)

      .property("selected", (d) => d.zone_id == edited_zone_id);
  }

  const dialog = h.append("dialog").attr("id", "dialog_tpm");
  dialog.append("div").attr("id", "edit_tpm");
  const dialog_b = dialog
    .append("div")
    .style("margin-top", "20px")
    .attr("class", "d-grid gap-2 d-md-flex justify-content-md-end");
  dialog_b
    .append("button")
    .attr("id", "close_tpm")
    // .attr("class", "button_tpm")
    .attr("class", "btn btn-outline-secondary")
    .text("Close")
    .on("click", cancel_tpm);
  dialog_b
    .append("button")
    .attr("id", "cancel_tpm")
    // .attr("class", "button_tpm")
    .attr("class", "btn btn-outline-secondary")
    .text("Cancel")
    .on("click", cancel_tpm);
  dialog_b
    .append("button")
    .attr("id", "update_tpm")
    // .attr("class", "button_tpm")
    .attr("class", "btn btn-outline-secondary")
    .text("Update")
    .on("click", update_tpm);

  if (scenario && scenario.tpm && Array.isArray(scenario.tpm)) {
    scenario_tpm = scenario.tpm;
    baseline = { tpm: scenario.baseline_tpm, area: scenario.baseline_area };
    // trigger_scenario_update();
  } else {
    baseline = baseline_projection.baseline;
    projection = structuredClone(b_projection);
    emission = get_carbon_emission(
      cstock,
      projection,
      abacus_data.other_emission_factor,
      date_diff_year(abacus_data.project.date1, abacus_data.project.date2)
    );
    // scenario = {};
  }
  if (!scenario.landcover) {
    scenario.landcover = abacus_data.landcover.map((d) => ({
      ...d,
      zone_id: 0,
      iteration_id: 0,
      c: cstock.find((e) => e.lc_id == d.lc_id).c,
    }));
  }
  if (!scenario.new_lc_id) {
    scenario.new_lc_id = [];
  }

  trigger_scenario_update();


  function update_chart(update_all = true) {
    const zone_id = edited_zone_id;
    const lc_data = projection.lc_area.filter(
      (d) =>
        d.iteration == edited_period_id && d.zone_id == zone_id && d.area > 0
    );
    edited_lc1_id_list = [];
    if (scenario_tpm != null && Array.isArray(scenario_tpm)) {
      const s = scenario_tpm.filter(
        (d) => d.iteration == edited_period_id && d.zone_id == zone_id
      );
      if (typeof s != "undefined")
        edited_lc1_id_list = Array.from(d3.union(s.map((d) => d.lc1_id)));
    }
    const plot = get_lc_conv_plot(
      lc_data,
      scenario.landcover,
      open_edit,
      edited_lc1_id_list,
      (width = width)
    );
    h.select("#lc_chart").selectAll("*").remove("*");
    h.select("#lc_chart")
      .selectAll("g")
      .data([,])
      .enter()
      .append(() => plot);
    if (update_all)
      stacked_lc_area(
        "#lc_area_chart",
        b_projection.lc_sum_area.filter((d) => d.zone_id == zone_id),
        projection.lc_sum_area.filter((d) => d.zone_id == zone_id),
        scenario.landcover,
        edited_period_id,
        get_iteration_year,
        select_period,
        width
      );
  }

  function select_period(period_id) {
    edited_period_id = period_id;
    update_chart(false);
    trigger_selection();
  }

  function select_zone(zone_id) {
    edited_zone_id = zone_id;
    update_chart();
    trigger_selection();
  }

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

  function open_edit(lc1_id, lc2_id) {
    edited_lc1_id = lc1_id;
    trigger_selection();
    if (edited_period_id == 0) {
      d3.select("#close_tpm").style("display", "inline-block");
      d3.select("#cancel_tpm").style("display", "none");
      d3.select("#update_tpm").style("display", "none");
    } else {
      d3.select("#close_tpm").style("display", "none");
      d3.select("#cancel_tpm").style("display", "inline-block");
      d3.select("#update_tpm").style("display", "inline-block");
    }

    var lc_tpm = projection.lc_area.filter(
      (d) =>
        d.iteration == edited_period_id &&
        d.zone_id == edited_zone_id &&
        d.lc1_id == edited_lc1_id
    );

    function is_locked_sc(lc2_id) {
      if (scenario_tpm == null) return false;
      const s = scenario_tpm.find(
        (d) =>
          d.iteration == edited_period_id &&
          d.zone_id == edited_zone_id &&
          d.lc1_id == edited_lc1_id &&
          d.lc2_id == Number(lc2_id) &&
          d.lock
      );
      if (typeof s == "undefined") return false;
      return true;
    }

    lc_tpm = lc_tpm.map((d) => ({ ...d, lock: is_locked_sc(d.lc2_id) }));
    // console.log("tpm add lock info")
    // console.log(lc_tpm)
    // lc_edit = structuredClone(lc_tpm);

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

    function add_row_tpm(row_tpm) {
      // console.log("add_row_tpm");
      // console.log(lc_edit);
      // console.log(lc_tpm)
      lc_edit.push(row_tpm);
      return lc_edit;
    }

    // function add_new_landcover(lc) {
    //   // console.log(lc);
    //   scenario.landcover.push(lc);
    //   scenario.new_lc_id.push(lc);
    //   // console.log("scenario.landcover");
    //   // console.log(scenario.landcover);
    //   return scenario.landcover;
    // }

    function update_lc_edit(le) {
      // console.log("update")
      // console.log(le)
      lc_edit = le;
    }

    lc_edit_obj = edit_tpm(
      "#edit_tpm",
      lc_tpm,
      lc_tpm_prev,
      edited_lc1_id,
      scenario.landcover,
      get_period_label(edited_period_id),
      edited_period_id == 0,
      LIB_PATH,
      add_row_tpm,
      // add_new_landcover,
      update_lc_edit
    );
    dialog.node().showModal();
    const b = d3.select("#lc_chart").node().getBoundingClientRect();
    const bd = d3.select("#edit_tpm").node().getBoundingClientRect();
    dialog.style.left = b.width / 2 - bd.width / 2 + "px";
    dialog.style.top = b.top + 10 + "px";
    selectInput(lc2_id);
  }

  function get_lc(lc_id) {
    // const l = baseline_projection.data.landcover.find((d) => d.lc_id == lc_id);
    const l = scenario.landcover.find((d) => d.lc_id == lc_id);
    if (typeof l == "undefined") return "";
    return l.label;
  }

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
        // const t_cont = baseline.tpm
        //   .filter((d) => d.zone_id == edited_zone_id && d.lc1_id == d.lc2_id)
        //   .map((d) => d.lc1_id);
        var lc1_base = baseline.tpm
          .filter((d) => d.zone_id == edited_zone_id)
          .map((d) => d.lc1_id);
        lc1_base = d3.union(lc1_base.values());

        // const t_diff = Array.from(d3.difference(diff, t_cont));
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
        // console.log(baseline.tpm);
        // console.log(baseline.area);
      }

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
    // select_period(selected_iteration);
    update_chart();
    // console.log("edit null")
    lc_edit = null;
  }

  function trigger_scenario_update() {
    projection = iterate_projection(baseline, scenario_tpm, n_iteration);
    emission = get_carbon_emission(
      // cstock,
      scenario.landcover,
      projection,
      abacus_data.other_emission_factor,
      date_diff_year(abacus_data.project.date1, abacus_data.project.date2)
    );

    // console.log(scenario_tpm);

    updateValue(
      "update:js_to_df",
      JSON.stringify({
        scenario: {
          tpm: scenario_tpm,
          baseline_tpm: baseline.tpm,
          baseline_area: baseline.area,
          landcover: scenario.landcover,
          new_lc_id: scenario.new_lc_id,
        },
        projection: projection,
        emission: emission,
      })
    );
  }

  function cancel_tpm() {
    dialog.node().close();
  }

  update_chart();
}

function get_lc_conv_plot(
  lc_data,
  landcovers,
  click_function,
  edited_lc1,
  width = 700
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

  function get_lc_label(lc_id) {
    const lc = landcovers.find((o) => o.lc_id == lc_id);
    if (typeof lc == "undefined") return "";
    return lc.label;
  }

  const lc_labels = lc_area.map((d) => get_lc_label(d.lc1_id));

  marginLeft = d3.max(lc_labels, (d) => d.length) * 6 + 35;

  // Compute the height from the number of stacks.
  const height = series[0].length * 25 + marginTop + marginBottom;

  // Prepare the scales for positional and color encodings.
  const x = d3
    .scaleLinear()
    .domain([0, d3.max(series, (d) => d3.max(d, (d) => d[1]))])
    .range([marginLeft, width - marginRight]);

  const y = d3
    .scaleBand()
    .domain(d3.sort(d3.union(lc_data.map((d) => d.lc1_id))))
    .range([marginTop, height - marginBottom])
    .padding(0.08);

  function get_color(lc_id) {
    lc = landcovers.find((d) => d.lc_id == lc_id);
    if (lc) return lc.color;
    return "gray";
  }

  // Create the SVG container.
  const svg = d3
    .create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto;");

  // Append a group for each series, and a rect for each element in the series.
  svg
    .append("g")
    .selectAll()
    .data(series)
    .join("g")
    // .attr("fill", (d) => color(d.key))
    .attr("fill", (d) => get_color(d.key))
    .selectAll("rect")
    .data((D) => D.map((d) => ((d.key = D.key), d)))
    .join("rect")
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
        .tickFormat((d) => get_lc_label(d)) //landcovers.find((o) => o.lc_id === d).label
    )
    .selectAll(".tick")
    .on("pointerenter pointermove", pointermoved_y)
    .on("pointerleave", pointerleft_y)
    .on("click", (e, d) => trigger_click(d));

  yaxis
    .selectAll("text")
    .style("color", (d) => (edited_lc1.includes(d) ? "red" : "black"))
    .attr("id", (d) => {
      return "lc" + d;
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
    .attr("text-anchor", "end")
    .attr("x", marginLeft + 60)
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

  function pointerleft_x(event, edata) {
    tooltip.style("display", "none");
    const el = yaxis.select("text#lc" + edata.data[0]);
    el.attr("font-weight", 300);
    el.style("font-size", "1em");
    event.target.setAttribute("stroke", null);
  }

  function pointerleft_y(event, edata) {
    disp_conv.style("display", "none");
    const el = yaxis.select("text#lc" + edata);
    el.attr("font-weight", 300);
    el.style("font-size", "1em");
  }

  // Add the event listeners that show or hide the tooltip.
  function pointermoved_x(event, edata) {
    tooltip.style("display", null);
    d3.select(this).style("cursor", "pointer");

    // const d = event.target.__data__;
    const lc_x_label = landcovers.find((o) => o.lc_id == edata.key).label;
    const lc_y_label = landcovers.find((o) => o.lc_id == edata.data[0]).label;
    const area = edata.data[1].get(edata.key).area;
    const r = edata.data[1].get(edata.key).r;

    // const el = yaxis.select("text#lc"+event.target.__data__.data[0]);
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
      "conversion to",
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

  function pointermoved_y(event, lc_id) {
    lc_id = Number(lc_id);
    var trans_tick = event.target.getAttribute("transform");
    if (trans_tick === null) return;
    d3.select(this).style("cursor", "pointer");
    // const el = yaxis.select("text#lc"+event.target.__data__);
    const el = yaxis.select("text#lc" + lc_id);
    el.attr("font-weight", 700);
    el.style("font-size", "1.1em");
    // event.target.setAttribute("font-weight", 700);

    const yt = trans_tick.match(/(-?[0-9\.]+)/g)[1];
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
      .map((d) => ({
        ...d,
        label: landcovers.find((e) => e.lc_id == d.lc2_id).label,
      }));
    const plot = get_single_lc_plot(
      lc_single,
      landcovers.find((e) => e.lc_id === lc_id).label,
      widthSubplot
    );

    const bplot = disp_conv
      .selectAll("g")
      .data([,])
      .enter()
      .append((d) => plot)
      .attr("y", 20);

    let { x, y, width: w, height: h } = bplot.node().getBBox();
    h += 20;
    // const {x, y, width: w, height: h} = disp_conv.node().getBBox();
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

  function trigger_click(lc1_id, lc2_id) {
    if (click_function === null) return;
    click_function(lc1_id, lc2_id);
  }

  return svg.node();
}

function get_single_lc_plot(lc_area, lc_label, width = 600) {
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
    // .domain(d3.sort(lc_area, d => -d.area).map(d => d.label))
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

  // Append a rect for each y ticks.
  svg
    .append("g")
    .attr("fill", "green")
    .attr("background", "green")
    .selectAll()
    .data(lc_area)
    .join("rect")
    .attr("x", x(0))
    .attr("y", (d) => y(d.label))
    .attr("width", (d) => x(d.area) - x(0))
    .attr("height", y.bandwidth());

  // Append a label for each y ticks.
  svg
    .append("g")
    .attr("fill", "white")
    .attr("text-anchor", "end")
    .style("font-size", "0.7em")
    .selectAll()
    .data(lc_area)
    .join("text")
    .attr("x", (d) => x(d.area))
    .attr("y", (d) => y(d.label) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("dx", -4)
    .text((d) => format(d.area))
    .call((text) =>
      text
        .filter((d) => x(d.area) - x(0) < 20) // short bars
        .attr("dx", +4)
        .attr("fill", "black")
        .attr("text-anchor", "start")
    );

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

  // var tblock =
  svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "start")
    .attr("x", 10)
    .attr("y", 10)
    .style("font-size", "0.9em")
    .attr("font-weight", 700)
    .text(lc_label);

  // tblock
  //   .append("tspan")
  //   .style("font-size", "0.9em")
  //   .attr("font-weight", 700)
  //   .text(lc_label);

  // tblock.append("tspan").style("font-size", "0.8em").text(" conversion to:");

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
    // .attr("font-weight", 700)
    .text("Converted area (ha)");

  return svg.node();
}

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
  // add_new_landcover,
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
  const red_bg = "#fde2e4";
  const green_bg = "#e9f5db";
  const yellow_bg = "#fcf6bd";
  const f = d3.format(",.0f");
  const f2 = d3.format(".2%");

  //***** Title
  const def_label = "Conversion based on previous projection";
  const mod_label = "Modified conversion (ha)";
  const base_label = "Converted into (ha):";
  const noconv_label = "⇏ Set no conversion";

  d3.select(div_id).selectAll("*").remove("*");
  const p = d3.select(div_id).append("div").attr("id", "tpm_editor");
  const t = p.append("div").attr("id", "title_panel");
  t.append("h3").text(`The conversion of: ${lc1_label}`);
  t.append("text").text(
    `Time period: ${period}\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0 Total area size: ${f(
      sum_area
    )} ha`
  );
  t.append("hr");
  if (!disable) {
    t.append("text").attr("class", "title_edit title_def").text(def_label);
    t.append("button").attr("id", "reset_button").text("⇒");
    t.append("text").attr("class", "title_edit").text(mod_label);
    t.append("button").attr("id", "noconv_button").text(noconv_label);
  } else {
    t.append("h3").attr("class", "title_edit").text(base_label);
  }
  t.append("hr");

  //****** Row content
  function find_def(lc2_id) {
    let a = lc_edit_default.find((d) => d.lc2_id == lc2_id);
    if (typeof a == "undefined") a = { area: 0, r: 0 };
    return a;
  }

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

  function add_rows(div_el, data_arr) {
    const row = div_el.selectAll().data(data_arr).enter().append("div");
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
        .text("➜");
    }
    row
      .append("input")
      .attr("class", "inp_lc_area")
      .attr("id", (d) => "lc_inp_" + d)
      .attr("value", (d) => f(find_edit(d).area))
      .on("focus", focusValue)
      .on("blur", blurValue)
      .on("input", inputValue);
    row
      .append("div")
      .attr("class", "inp_lc_area_ratio")
      .attr("id", (d) => "r_lc_inp_" + d)
      .text((d) => f2(find_edit(d).r));

    if (!disable) {
      const locklab = row.append("label").attr("class", "inp_lock_label");
      locklab
        .append("input")
        .attr("class", "inp_lock")
        .attr("id", (d) => "cb_lc_inp_" + d)
        .attr("type", "checkbox")
        .property("checked", (d) => find_edit(d).lock)
        .on("click", updateLock);

      locklab
        .append("img")
        .attr("class", "img-lock")
        .style("height", "12px")
        .attr("src", LIB_PATH.concat("lock-open.svg"));
      locklab
        .append("img")
        .attr("class", "img-lock-checked")
        .style("height", "12px")
        .attr("src", LIB_PATH.concat("lock.svg"));
    }
    row
      .append("div")
      .attr("class", "lc_label")
      .text((d) => get_landcover(d));
  }
  p.append("hr");

  //create land cover list menu
  if (!disable) {
    const lc = landcovers.filter((d) => !lc2arr.includes(d.lc_id));
    const dd = p
      .append("div")
      .attr("class", "dropdown")
      .attr("id", "lc_dropdown");
    p.append("button")
      .attr("class", "dropbtn")
      .text("+")
      .on("click", click_add);
    const lc_list = dd
      .append("div")
      .attr("class", "dropdown-content")
      .attr("id", "myDropdown");
    lc_list
      .selectAll("div")
      .data(lc)
      .enter()
      .append("div")
      .attr("href", "#")
      .attr("id", (d) => "add_" + d.lc_id)
      .text((d) => d.label)
      .on("click", click_add_lc);
    // lc_list
    //   .append("button")
    //   .attr("id", "add_new_lc_button")
    //   .attr("class", "btn btn-outline-secondary")
    //   .text("+ New Land Cover")
    //   .style("padding", "5px 10px")
    //   .style("margin", "10px")
    //   .on("click", () => new_lc_dialog.showModal());
  }

  //create dialog to add new land cover
  // const nlcdialog = d3
  //   .selectAll("body")
  //   .append("dialog")
  //   .attr("id", "new_lc_dialog");
  // nlcdialog.append("h4").text("Add new land cover");
  // const r1 = nlcdialog.append("p");
  // r1.append("div")
  //   .text("Label")
  //   .style("display", "inline-block")
  //   .style("text-align", "right")
  //   .style("margin-right", "10px")
  //   .style("width", "100px");
  // r1.append("input").attr("id", "lc_label_input").style("width", "300px");
  // const r2 = nlcdialog.append("p");
  // r2.append("div")
  //   .text("Description")
  //   .style("display", "inline-block")
  //   .style("text-align", "right")
  //   .style("margin-right", "10px")
  //   .style("width", "100px");
  // r2.append("input").attr("id", "lc_desc_input").style("width", "300px");
  // const r2b = nlcdialog.append("p");
  // r2b
  //   .append("div")
  //   .html("Carbon stock (tC ha<sup>-1</sub>)")
  //   .style("display", "inline-block")
  //   .style("text-align", "right")
  //   .style("margin-right", "10px")
  //   .style("width", "200px");
  // r2b
  //   .append("input")
  //   .attr("id", "lc_carbon_input")
  //   .attr("type", "number")
  //   .property("value", 0)
  //   .style("text-align", "right")
  //   .style("width", "200px");
  // const r3 = nlcdialog
  //   .append("div")
  //   .attr("class", "d-grid gap-2 d-md-flex justify-content-md-end");
  // r3.append("button")
  //   .attr("class", "btn btn-outline-secondary")
  //   .text("Cancel")
  //   .on("click", () => new_lc_dialog.close());
  // r3.append("button")
  //   .text("Add")
  //   .attr("class", "btn btn-outline-secondary")
  //   .on("click", add_new_lc);

  // const new_lc_dialog = document.getElementById("new_lc_dialog");

  function click_add(e) {
    var h = document.getElementById("tpm_editor").clientHeight;
    document.getElementById("myDropdown").classList.toggle("show");
    d3.select(".dropdown-content").style("height", h + "px");
    //TODO: set width nya juga berdasar content!
  }

  function click_add_lc(e) {
    const lc2_id = Number(e.target.id.substring(4));
    add_lc(lc2_id);
  }

  function add_lc(lc2_id) {
    const new_lc = get_new_lc(lc2_id);
    // lc_edited = 
    add_row_tpm(new_lc);
    const tlist = d3.select("#tpm_list");
    add_rows(tlist, [lc2_id]);
    d3.select("#add_" + lc2_id).remove();
  }

  // function add_new_lc(e) {
  //   const new_id = d3.max(landcovers.map((d) => d.lc_id)) + 1;
  //   const l = document.getElementById("lc_label_input").value;
  //   const d = document.getElementById("lc_desc_input").value;
  //   const c = document.getElementById("lc_carbon_input").value;
  //   new_lc_dialog.close();
  //   const new_lc = {
  //     lc_id: new_id,
  //     color: getRandomColor(),
  //     label: l,
  //     description: d,
  //     zone_id: 0,
  //     iteration_id: 0,
  //     c: c,
  //   };
  //   // landcovers.push(new_lc);
  //   landcovers = add_new_landcover(new_lc);
  //   // n = structuredClone(new_lc);
  //   // n.carbonstock = c;
  //   // new_landcovers.push(n);
    
  //   // add_lc(new_id);
  // }

  // function getRandomColor() {
  //   var letters = "0123456789ABCDEF".split("");
  //   var color = "#";
  //   for (var i = 0; i < 6; i++) {
  //     color += letters[Math.round(Math.random() * 15)];
  //   }
  //   return color;
  // }

  d3.select("#reset_button").on("click", reset_todefault);
  d3.selectAll(".def_button").on("click", set_todefault);
  d3.select("#noconv_button").on("click", set_no_conversion);
  const lc_labels = lc_edited.map((d) => get_landcover(d.lc2_id));
  const label_width = d3.max(lc_labels, (d) => d.length) * 5.5 + 35;
  d3.selectAll(".lc_label").attr("width", label_width);

  lc_edited
    .filter((d) => d.lock)
    .forEach((d) => set_input_bg(d.lc2_id, red_bg));

  if (disable) {
    d3.selectAll(".inp_lc_area")
      .attr("disabled", "true")
      .style("background", yellow_bg)
      .style("padding", "4px")
      .style("border", "0px")
      .style("border-radius", "4px");
    d3.selectAll(".inp_lc_area_ratio").style("background", yellow_bg);
  }

  function reset_todefault(e) {
    lc_edit_default.forEach((d) => {
      let o = lc_edited.find((f) => f.lc2_id === d.lc2_id);
      o.area = d.area;
      o.r = d.r;
      document.querySelector("#lc_inp_" + d.lc2_id).value = f(d.area);
      document.querySelector("#r_lc_inp_" + d.lc2_id).textContent = f2(d.r);
    });
  }

  function set_todefault(e) {
    const id = Number(e.target.id.substring(13));
    const el = get_input_element(id);
    const v = lc_edit_default.find((e) => e.lc2_id === id).area;
    updateValue(el, v);
    el.element.value = f(el.edit.area);
  }

  function set_no_conversion(e) {
    const o = lc_edited.filter((d) => d.lock);
    o.forEach((d) => {
      if (d.lc2_id == lc1_id) return;
      d.lock = false;
      document.querySelector("#cb_lc_inp_" + d.lc2_id).checked = false;
      set_input_bg(d.lc2_id, green_bg);
    });
    const el = get_input_element(lc1_id);
    updateValue(el, sum_area);
  }

  function updateLock(e) {
    if (e.target.checked) {
      const inp_lock = d3.selectAll(".inp_lock");
      if (d3.every(inp_lock, (d) => d.checked)) {
        e.target.checked = false;
        return;
      }
    }
    const id = Number(e.target.id.substring(10));
    const lc = lc_edited.find((d) => d.lc2_id === id);
    lc.lock = e.target.checked;
    set_input_bg(id, e.target.checked ? red_bg : green_bg);
    if (!e.target.checked) update_unlocked_area();
  }

  function set_input_bg(id, c) {
    const a1 = document.querySelector("#" + "lc_inp_" + id);
    const a2 = document.querySelector("#" + "r_lc_inp_" + id);
    a1.style.backgroundColor = c;
    a2.style.backgroundColor = c;
    a1.style.borderColor = c == red_bg ? "red" : "green";
  }

  function get_input_element(id) {
    const inp = document.querySelector("#" + "lc_inp_" + id);
    const o = find_edit(id);
    return { id: id, element: inp, edit: o };
  }

  function focusValue(e) {
    const id = Number(e.target.id.substring(7));
    const el = get_input_element(id);
    el.element.value = el.edit.area;
    el.element.select();
  }

  function blurValue(e) {
    const id = Number(e.target.id.substring(7));
    const el = get_input_element(id);
    let v = el.element.value;
    const fc = v.slice(0, 1);
    if (fc == "+" || fc == "-") {
      const vDef = v;
      const def = lc_edit_default.find((e) => e.lc2_id === id);
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
  }

  function inputValue(e) {
    const id = Number(e.target.id.substring(7));
    // console.log(id);
    const el = get_input_element(id);
    let v = el.element.value;
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
    if (Number(v) <= 100) {
      return;
    }
    updateValue(el, Math.abs(Number(v)));
  }

  function updateValue(el, v) {
    const inp_lock = d3.selectAll(".inp_lock");
    if (isNaN(v)) v = el.edit.area;
    if (v !== el.edit.area) {
      let lock = document.querySelector("#" + "cb_lc_inp_" + el.id);
      lock.checked = true;
      // at least one lc should be unlocked
      if (d3.every(inp_lock, (d) => d.checked)) {
        lock.checked = false;
        el.element.value = f(el.edit.area);
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
      update_unlocked_area();
    }
    el.element.value = v;
    update_lc_edit(lc_edited);
  }

  function get_default_area(lc2_id) {
    const def = lc_edit_default.find((e) => e.lc2_id === lc2_id); //.area
    if (typeof def == "undefined") return 0;
    return def.area;
  }

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
          d.area = (remain_a * get_default_area(d.lc2_id)) / edit_a;
        }
      }
      d.r = d.area / sum_area;
      d3.select("#lc_inp_" + d.lc2_id).attr("value", f(d.area));
      d3.select("#r_lc_inp_" + d.lc2_id).text(f2(d.r));
      // document.querySelector("#lc_inp_" + d.lc2_id).value = f(d.area);
      // document.querySelector("#r_lc_inp_" + d.lc2_id).textContent = f2(d.r);
    });
  }

  // Close the dropdown menu if the user clicks outside of it
  window.onclick = function (event) {
    if (!event.target.matches(".dropbtn")) {
      var dropdowns = document.getElementsByClassName("dropdown-content");
      var i;
      for (i = 0; i < dropdowns.length; i++) {
        var openDropdown = dropdowns[i];
        if (openDropdown.classList.contains("show")) {
          openDropdown.classList.remove("show");
        }
      }
    }
  };

  // return {
  //   lc_edited: lc_edited,
  //   lc_edit_default: lc_edit_default,
  //   landcovers: landcovers,
  //   new_landcovers: new_landcovers,
  // };
}

function selectInput(lc_id) {
  if (typeof lc_id === "undefined") return;
  const input = document.querySelector("#lc_inp_" + lc_id);
  input.focus();
  input.select();
}

function stacked_lc_area(
  div_id,
  bs_area,
  sc_area,
  landcover,
  selected_period = 0,
  get_iteration_year,
  click_period = null,
  width = 300
) {
  // Specify the chart’s dimensions.
  // const width = 300;

  const height = 250;
  const marginTop = 20;
  const marginRight = 20;
  const marginBottom = 60;
  const marginLeft = 30;

  const n_iteration = d3.max(bs_area.map((d) => d.iteration));
  let line_data = sc_area.filter((d) => d.lc1_id == 0);

  // Determine the series that need to be stacked.
  const series = d3
    .stack()
    .keys(d3.union(sc_area.map((d) => d.lc1_id))) // distinct series keys, in input order
    // .value(([, D], key) => D.get(key).area) // get value for each series key and stack
    .value(([, D], key) =>
      typeof D.get(key) === "undefined" ? 0 : D.get(key).area
    )(
    // console.log(series);
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
    .domain([0, d3.max(series, (d) => d3.max(d, (d) => d[1]))])
    .rangeRound([height - marginBottom, marginTop]);

  const color = d3
    .scaleOrdinal()
    .domain(series.map((d) => d.key))
    .range(d3.schemeTableau10);

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
  d3.select(div_id).selectAll("*").remove("*");
  const svg = d3
    .select(div_id)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto;");

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
    // .attr("fill", (d) => color(d.key))
    .attr("fill", (d) => get_color(d.key))
    .attr("d", area)
    .on("pointerenter pointermove", pointermoved_y)
    .on("pointerleave", pointerleft_y)
    .on("click", clicked)
    .append("title")
    .text((d) => get_lc_label(d.key));
  const xaxis = svg
    .append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickSizeOuter(0)
        .ticks(n_iteration + 1)
        .tickFormat((d) => get_iteration_year(d))
    );

  svg
    .on("pointerenter pointermove", pointermoved_x)
    .on("pointerleave", pointerleft_x)
    .on("click", clicked);

  svg
    .append("text")
    .attr("x", width - marginRight)
    .attr("y", 15)
    .text("Projected land cover area (ha)")
    .style("font-size", "0.9em")
    .attr("text-anchor", "end");
  svg
    .append("text")
    .attr("x", marginLeft)
    .attr("y", height - 5)
    .text("Selected period:")
    .style("font-size", "1em");
  const periodtxt = svg
    .append("text")
    .attr("x", 145)
    .attr("y", height - 5)
    .text("0000")
    .style("font-size", "1em")
    .attr("font-weight", 700);

  const markerBoxWidth = 3;
  const markerBoxHeight = 3;
  const arrowPoints = [
    [0, 0],
    [0, 3],
    [3, 1.5],
  ];

  function define_arrow_marker(color) {
    const id = "arrow_" + color;
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
      .attr("d", d3.line()(arrowPoints))
      .attr("fill", color);
    return "url(#" + id + ")";
  }

  function define_line(color) {
    const arrow = define_arrow_marker(color);
    const line = svg
      .append("line")
      .attr("x1", 0)
      .attr("y1", height - 35)
      .attr("x2", 0)
      .attr("y2", height - 35)
      .style("stroke", color)
      .attr("stroke-width", 3)
      .attr("fill", color)
      .attr("marker-start", arrow)
      .attr("marker-end", arrow);
    return line;
  }

  const line = define_line("lightgray").style("display", "none");
  const selected_line = define_line("black");

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
  const selected_rect = define_rect("black");

  function get_lc_label(lc_id) {
    const lc = landcover.find((o) => o.lc_id == lc_id);
    if (typeof lc == "undefined") return "";
    return lc.label;
  }

  const tooltip = d3
    .select(div_id)
    .append("div")
    .attr("id", "tooltip_area")
    .style("width", width * 0.8 + "px")
    .style("display", "none");

  function pointerleft_y(event, edata) {
    tooltip.style("display", "none");
    line.style("display", "none");
    rect.style("display", "none");
    event.target.setAttribute("stroke", null);
  }

  function pointermoved_y(event, edata) {
    tooltip.style("display", null);
    line_data = sc_area.filter((d) => d.lc1_id == edata.key);
    const line_data_base = bs_area.filter((d) => d.lc1_id == edata.key);
    // console.log("line: " + edata.key);
    // console.log(line_data_base);
    // console.log(line_data);
    line_plot_area(
      "#tooltip_area",
      line_data_base,
      line_data,
      get_iteration_year,
      get_lc_label(edata.key),
      get_color(edata.key),
      width
    );
    event.target.setAttribute("stroke", "black");
    event.target.setAttribute("stroke-width", 2);
    const { x: xp, y: yp, width: wp, height: hp } = event.target.getBBox();
    var rect = document.querySelector(div_id).getBoundingClientRect();
    d3.select("#tooltip_area").style(
      "top",
      rect.top - rect.height + yp + hp + 10 + "px"
    );
    pointermoved_x(event);
  }

  function pointerleft_x(event) {
    line.style("display", "none");
    rect.style("display", "none");
  }

  function pointermoved_x(event) {
    const c = x.invert(d3.pointer(event)[0]);
    const x1 = Math.floor(c);
    const x2 = Math.ceil(c);
    if (x1 < 0 || x1 > n_iteration - 1) {
      pointerleft_x(event);
      return;
    }
    line.style("display", null);
    if (selected_period == x1) {
      rect.style("display", "none");
    } else {
      rect.style("display", null);
    }
    line.attr("x1", x(x1) + markerBoxWidth).attr("x2", x(x2) - markerBoxWidth);
    rect.attr("x", x(x1));
  }

  set_selection(selected_period);

  function set_selection(period) {
    selected_period = period;
    selected_line
      .transition()
      .attr("x1", x(period) + markerBoxWidth)
      .attr("x2", x(period + 1) - markerBoxWidth);
    selected_rect.transition().attr("x", x(period));
    const addt = period == 0 ? " [baseline]" : "";
    periodtxt.text(
      get_iteration_year(period) + "-" + get_iteration_year(period + 1) + addt
    );
  }

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

function line_plot_area(
  div_id,
  bs_area,
  sc_area,
  get_iteration_year,
  lc_label,
  lc_color,
  width = 300
) {
  // Specify the chart’s dimensions.
  // const width = 300;
  width = width * 0.8;
  const height = 200;
  const marginTop = 40;
  const marginRight = 30;
  const marginBottom = 50;
  const marginLeft = 70;

  if (bs_area.length == 0) {
    bs_area = sc_area.map((d) => ({
      iteration: d.iteration,
      zone_id: d.zone_id,
      lc1_id: d.lc1_id,
      area: 0,
    }));
  }

  const n_iteration = d3.max(bs_area.map((d) => d.iteration));

  // Prepare the scales for positional and color encodings.
  const x = d3
    .scaleLinear()
    .domain(d3.extent(bs_area, (d) => d.iteration))
    .range([marginLeft, width - marginRight]);

  const y = d3
    .scaleLinear()
    .domain(d3.extent(bs_area.concat(sc_area), (d) => d.area))
    .rangeRound([height - marginBottom, marginTop]);

  // Declare the line generator.
  const line = d3
    .line()
    .x((d) => x(d.iteration))
    .y((d) => y(d.area));

  // Create the SVG container.
  d3.select(div_id).selectAll("*").remove("*");
  const svg = d3
    .select(div_id)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto; color:white;");

  svg
    .append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(d3.axisLeft(y).ticks(height / 50, "s"))
    .call((g) =>
      g
        .selectAll(".tick line")
        .clone()
        .attr("x2", width - marginLeft - marginRight)
        .attr("stroke-opacity", 0.1)
    );

  const xaxis = svg
    .append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickSizeOuter(0)
        .ticks(n_iteration + 1)
        .tickFormat((d) => get_iteration_year(d))
    );

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

  svg
    .append("circle")
    .attr("cx", width - 35)
    .attr("cy", 18)
    .attr("r", 12)
    .style("fill", lc_color);
  // Add X axis label:
  svg
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", width - 60)
    .attr("y", marginTop - 20)
    .style("font-size", "0.9em")
    .style("fill", "white")
    .text(lc_label);

  svg
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", -marginTop)
    .attr("y", 25)
    .attr("transform", "rotate(-90)")
    .style("font-size", "0.8em")
    .style("fill", "white")
    .text("Total area (ha)");

  //legend
  svg
    .append("circle")
    .attr("cx", 80)
    .attr("cy", 180)
    .attr("r", 4)
    .style("fill", "red");
  svg
    .append("circle")
    .attr("cx", 220)
    .attr("cy", 180)
    .attr("r", 4)
    .style("fill", "lightgrey");

  svg
    .append("text")
    .attr("x", 90)
    .attr("y", 180)
    .text("scenario projection")
    .style("font-size", "0.8em")
    .attr("alignment-baseline", "middle")
    .style("fill", "white");
  svg
    .append("text")
    .attr("x", 230)
    .attr("y", 180)
    .text("baseline projection")
    .style("font-size", "0.8em")
    .attr("alignment-baseline", "middle")
    .style("fill", "white");
}

function planning_unit_map(
  div_id,
  abacus_data,
  selected_zone_id = 0,
  click_zone = null
) {
  // Specify the chart’s dimensions.
  const width = 200;
  const height = 150;
  const marginTop = 20;
  const marginBottom = 30;
  const a = d3
    .rollups(
      abacus_data.landcover_change,
      (v) => d3.sum(v, (d) => d.area),
      (d) => d.zone_id
    )
    .map((d) => ({ name: d[0], value: d[1] }));

  const data = {
    name: "Planning unit",
    children: a,
  };

  // Compute the layout.
  const root = d3
    .treemap()
    // .tile(tile) // e.g., d3.treemapSquarify
    .size([width, height])
    .padding(3)
    .round(true)(
    d3
      .hierarchy(data)
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value)
  );

  function get_zone_label(zone_id) {
    if (typeof abacus_data.zone == "undefined") return "";
    // console.log(abacus_data.zone)
    const z = abacus_data.zone.find((e) => e.zone_id == zone_id);
    if (typeof z == "undefined") return "";
    return z.label;
  }
  // Create the SVG container.
  d3.select(div_id).selectAll("*").remove("*");
  const svg = d3
    .select(div_id)
    .append("svg")
    .attr("viewBox", [0, 0, width, height + marginTop + marginBottom])
    .attr("width", width)
    .attr("height", height + marginTop + marginBottom)
    .attr("style", "max-width: 100%; height: auto;");

  // Add a cell for each leaf of the hierarchy.
  const leaf = svg
    .selectAll("g")
    .data(root.leaves())
    .join("g")
    .attr("transform", (d) => `translate(${d.x0},${d.y0 + marginTop})`);

  // Append a tooltip.
  const format = d3.format(",d");
  leaf.append("title").text(
    (d) =>
      `${d
        .ancestors()
        .reverse()
        .map((d) => get_zone_label(d.data.name))
        .join("")}\n${format(d.value)} ha`
  );

  // Append a color rectangle.
  const rect = leaf
    .append("rect")
    // .attr("id", (d) => (d.leafUid = DOM.uid("leaf")).id)
    // .attr("fill", d => { while (d.depth > 1) d = d.parent; return color(d.data.name); })
    .attr("fill", (d) => (d.data.name == selected_zone_id ? "red" : "green"))
    .attr("fill-opacity", 0.6)
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => d.y1 - d.y0)
    .on("pointerenter pointermove", pointermoved)
    .on("pointerleave", pointerleft)
    .on("click", clicked);
  // Append a clipPath to ensure text does not overflow.
  leaf
    .append("clipPath")
    // .attr("id", (d) => (d.clipUid = DOM.uid("clip")).id)
    .append("use");
  // .attr("xlink:href", (d) => d.leafUid.href);

  // Append multiline text. The last line shows the value and has a specific formatting.
  leaf
    .append("text")
    .attr("clip-path", (d) => d.clipUid)
    .style("font-size", "0.7em")
    .selectAll("tspan")
    .data((d) => d)
    .join("tspan")
    .attr("x", 3)
    .attr("y", 12)
    .text((d) => get_zone_label(d.data.name));

  leaf
    .append("text")
    .attr("clip-path", (d) => d.clipUid)
    .style("font-size", "0.5em")
    .selectAll("tspan")
    .data((d) => d)
    .join("tspan")
    .attr("x", 3)
    .attr("y", 25)
    .text((d) => format(d.value) + " ha");

  svg
    .append("text")
    .attr("x", width - 3)
    .attr("y", 15)
    .text("Planning unit area (ha)")
    .style("font-size", "0.7em")
    .attr("text-anchor", "end");
  svg
    .append("text")
    .attr("x", 3)
    .attr("y", height + 45)
    .text("Planning unit:")
    .style("font-size", "0.9em");
  const selectedpu = svg
    .append("text")
    .attr("x", 90)
    .attr("y", height + 45)
    .text("0000")
    .style("font-size", "0.9em")
    .attr("font-weight", 700)
    .text(get_zone_label(selected_zone_id));

  function pointerleft(event, edata) {
    event.target.setAttribute("stroke", null);
  }

  function pointermoved(event, edata) {
    event.target.setAttribute("stroke", "black");
  }

  function clicked(event, d) {
    selected_zone_id = d.data.name;
    if (click_zone != null) click_zone(selected_zone_id);
    selectedpu.text(get_zone_label(selected_zone_id));
    leaf
      .selectAll("rect")
      .attr("fill", (d) => (d.data.name == selected_zone_id ? "red" : "green"));
  }
}
