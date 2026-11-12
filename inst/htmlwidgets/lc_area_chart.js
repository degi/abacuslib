/**
 * HTMLWidgets binding for the Land Cover Area Chart.
 * Displays observed and projected land cover areas as a stacked area streamgraph or time series.
 */
HTMLWidgets.widget({
  name: "lc_area_chart",

  type: "output",

  /**
   * Factory function initializing the widget instance.
   * @param {HTMLElement} el - The DOM container element.
   * @param {number} width - Container width in pixels.
   * @param {number} height - Container height in pixels.
   * @returns {Object} Widget instance with renderValue and resize handlers.
   */
  factory: function (el, width, height) {
    el.classList.add("lc_area_chart");
    el.classList.add("lc_projection_chart");
    let currentParams = null;
    let currentWidth = width || el.clientWidth || 700;
    let currentHeight = height || el.clientHeight || 280;

    /**
     * Sends custom event data back to Shiny input bindings.
     * @param {string} type - Event identifier suffix.
     * @param {*} data - Payload data.
     */
    const updateValue = function (type, data) {
      if (HTMLWidgets.shinyMode) {
        Shiny.setInputValue(el.id + "_" + type, data);
      }
    };

    return {
      /**
       * Renders the land cover area chart using provided parameters.
       * @param {Object} params - Data and options passed from R.
       */
      renderValue: function (params) {
        currentParams = params;
        const data = typeof params.data === "string"
          ? JSON.parse(params.data)
          : params.data;
        const scenario = typeof params.scenario === "string"
          ? JSON.parse(params.scenario)
          : params.scenario;
        currentWidth = el.clientWidth || width || currentWidth;
        currentHeight = el.clientHeight || height || currentHeight;
        el.innerHTML = "";
        render_lc_area_chart(
          el,
          data,
          scenario,
          params.selected_iteration,
          params.selected_zone,
          params.show_period_selection,
          currentWidth,
          updateValue,
          currentHeight
        );
      },

      /**
       * Re-renders the chart dynamically upon container resize.
       * @param {number} newWidth - Updated container width.
       * @param {number} newHeight - Updated container height.
       */
      resize: function (newWidth, newHeight) {
        if (!currentParams) return;
        currentWidth = newWidth || el.clientWidth || currentWidth;
        currentHeight = newHeight || el.clientHeight || currentHeight;
        const data = typeof currentParams.data === "string"
          ? JSON.parse(currentParams.data)
          : currentParams.data;
        const scenario = typeof currentParams.scenario === "string"
          ? JSON.parse(currentParams.scenario)
          : currentParams.scenario;
        el.innerHTML = "";
        render_lc_area_chart(
          el,
          data,
          scenario,
          currentParams.selected_iteration,
          currentParams.selected_zone,
          currentParams.show_period_selection,
          currentWidth,
          updateValue,
          currentHeight
        );
      },
    };
  },
});
