/**
 * HTMLWidgets binding for the Scenario Editor.
 * Provides interactive visual editing of land cover transitions via stacked bar charts or matrix views.
 */
HTMLWidgets.widget({
  name: "scenario_editor",

  type: "output",

  /**
   * Factory function initializing the scenario editor widget instance.
   * @param {HTMLElement} el - The DOM container element.
   * @param {number} width - Container width in pixels.
   * @param {number} height - Container height in pixels.
   * @returns {Object} Widget instance with renderValue, resize, and updateValue methods.
   */
  factory: function (el, width, height) {
    const IMAGE_LIB_LOCAL = "lib/d3-7.8.5/images/";
    const IMAGE_LIB_WEB =
      "https://raw.githubusercontent.com/degi/abacuslib/main/inst/htmlwidgets/lib/images/";

    // API variables
    var elementId = el.id;
    var container = document.getElementById(elementId);
    var initialized = false;
    let LIB_PATH;
    const chart_id = elementId ? elementId + "_luchart" : "luchart";

    return {
      /**
       * Renders or refreshes the scenario editor widget.
       * @param {Object} params - Widget parameters passed from R/Shiny.
       */
      renderValue: function (params) {
        try {
          if (HTMLWidgets.shinyMode) {
            LIB_PATH = IMAGE_LIB_WEB;
          } else {
            LIB_PATH = IMAGE_LIB_LOCAL;
          }

          const is_editable =
            typeof params.editable !== "undefined"
              ? Boolean(params.editable)
              : true;
          const initial_view = params.initial_view_mode || "bar";

          const abacus_data = params.data;
          if (abacus_data && abacus_data.project) {
            if (abacus_data.project.date1) {
              const d1 = Array.isArray(abacus_data.project.date1)
                ? abacus_data.project.date1[0]
                : abacus_data.project.date1;
              abacus_data.project.date1 = parseDate(d1);
            }
            if (abacus_data.project.date2) {
              const d2 = Array.isArray(abacus_data.project.date2)
                ? abacus_data.project.date2[0]
                : abacus_data.project.date2;
              abacus_data.project.date2 = parseDate(d2);
            }
          }

          const n_iter = (abacus_data && abacus_data.project && Array.isArray(abacus_data.project.n_iteration))
            ? abacus_data.project.n_iteration[0]
            : (abacus_data && abacus_data.project ? abacus_data.project.n_iteration : 4);

          // Calculate baseline projection from data
          const baseline_projection = get_baseline_projection(
            abacus_data,
            n_iter || 4
          );

          if (is_editable) {
            this.updateValue(
              "baseline:js_to_df",
              JSON.stringify(baseline_projection)
            );
          }

          // Preserve current view mode across re-renders (zone / period change), scoped strictly to this widget element
          const _prev_matrix_btn = el.querySelector(".lc-view-btn-matrix");
          const _view_mode = _prev_matrix_btn
            ? (_prev_matrix_btn.classList.contains("lc-view-btn-active") ? "matrix" : "bar")
            : initial_view;

          el.innerHTML = "";
          let chart = document.createElement("div");
          chart.id = chart_id;
          chart.className = "luchart";
          chart.style.fontFamily = "Arial, Helvetica, sans-serif";
          chart.style.fontSize = "0.9em";
          chart.style.width = "100%";
          chart.style.height = "100%";
          chart.style.display = "flex";
          chart.style.flexDirection = "column";
          chart.style.minHeight = "0";
          chart.style.position = "relative";
          el.appendChild(chart);

          // Initialize and render the conversion editor and matrix / bar views
          show_lc_conversion(
            chart,
            baseline_projection,
            LIB_PATH,
            this.updateValue,
            params.scenario,
            params.selected_iteration,
            params.selected_zone,
            params.selected_lc,
            el.clientWidth || width || 700,
            _view_mode,
            is_editable
          );

          // Register a Shiny custom message handler (once per widget instance)
          if (is_editable) {
            if (!window._abacus_msg_registered) {
              window._abacus_msg_registered = {};
            }
            if (!window._abacus_msg_registered[elementId]) {
              window._abacus_msg_registered[elementId] = true;
              Shiny.addCustomMessageHandler(
                "open_lc_edit_" + elementId,
                function (msg) {
                  setTimeout(function () {
                    var chartEl = document.getElementById(chart_id) || chart;
                    if (chartEl && chartEl._abacus_open_edit) {
                      chartEl._abacus_open_edit(msg.lc1_id);
                    }
                  }, 200);
                }
              );
            }
          }
        } catch (error) {
          console.error("scenario_editor renderValue error:", error);
          console.error(error.stack);
        }
      },

      /**
       * Handles widget container resizing.
       * @param {number} width - New container width.
       * @param {number} height - New container height.
       */
      resize: function (width, height) {
        // Dynamic re-render handled by SVG responsive viewboxes
      },

      /**
       * Dispatches custom input events to Shiny when in Shiny mode.
       * @param {string} type - Event/input name suffix.
       * @param {*} data - Payload data sent to Shiny.
       */
      updateValue: function (type, data) {
        if (HTMLWidgets.shinyMode) {
          Shiny.setInputValue(elementId + "_" + type, data);
        }
      },
    };
  },
});
