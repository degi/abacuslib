/**
 * HTMLWidgets binding for the legacy curve / abacus widget.
 * Initializes the baseline projection and renders the land cover conversion view.
 */
HTMLWidgets.widget({
  name: "curve",

  type: "output",

  /**
   * Widget factory creating an instance of the curve widget.
   * @param {HTMLElement} el - The DOM element hosting the widget.
   * @param {number} width - The initial width of the widget container.
   * @param {number} height - The initial height of the widget container.
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
    const chart_id = "ac_curve";

    return {
      /**
       * Renders or updates widget data and UI components.
       * @param {Object} params - Widget parameters passed from R.
       */
      renderValue: function (params) {
        if (HTMLWidgets.shinyMode) {
          LIB_PATH = IMAGE_LIB_WEB;
        } else {
          LIB_PATH = IMAGE_LIB_LOCAL;
        }

        const abacus_data = params.data;
        if (abacus_data.version == 2) {
          abacus_data.project.date1 = parseDate(abacus_data.project.date1[0]);
          abacus_data.project.date2 = parseDate(abacus_data.project.date2[0]);
        }

        // Calculate baseline projection from abacus data
        const baseline_projection = get_baseline_projection(
          abacus_data,
          abacus_data.project.n_iteration[0]
        );

        // Send serialized baseline projection back to Shiny
        this.updateValue(
          "baseline:js_to_df",
          JSON.stringify(baseline_projection)
        );

        let chart = document.createElement("div");
        chart.id = chart_id;
        el.appendChild(chart);

        // Render land cover conversion interface
        show_lc_conversion(
          chart_id,
          baseline_projection,
          LIB_PATH,
          this.updateValue,
          params.scenario,
          params.selected_iteration,
          params.selected_zone,
          params.selected_lc
        );
      },

      /**
       * Resizes the widget when the container dimensions change.
       * @param {number} width - New container width.
       * @param {number} height - New container height.
       */
      resize: function (width, height) {
        // Resizing handled by child SVG elements
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
