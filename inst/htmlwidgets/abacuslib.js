HTMLWidgets.widget({
  name: "abacuslib",

  type: "output",

  factory: function (el, width, height) {
    // TODO: define shared variables for this instance
    const IMAGE_LIB_LOCAL = "lib/d3-7.8.5/images/";
    const IMAGE_LIB_WEB =
      "https://raw.githubusercontent.com/degi/abacuslib/main/inst/htmlwidgets/lib/images/";

    //API variables
    var elementId = el.id;
    var container = document.getElementById(elementId);
    var initialized = false;
    let LIB_PATH;
    const chart_id = "luchart";
    return {
      renderValue: function (params) {
        
        if (HTMLWidgets.shinyMode) {
          LIB_PATH = IMAGE_LIB_WEB;
        } else {
          LIB_PATH = IMAGE_LIB_LOCAL;
        }

        const abacus_data = params.data;
        if(abacus_data.version == 2) {
          abacus_data.project.date1 = parseDate(abacus_data.project.date1[0]);
          abacus_data.project.date2 = parseDate(abacus_data.project.date2[0]);
        }
        
        const baseline_projection = get_baseline_projection(abacus_data, abacus_data.project.n_iteration[0]);
        // console.log(baseline_projection);
        this.updateValue("baseline:js_to_df", JSON.stringify(baseline_projection))
        let chart = document.createElement("div");
        chart.id = chart_id;
        el.appendChild(chart);
        let sc = null;
        if(params.scenario.tpm) {
          sc = params.scenario;
        }
        show_lc_conversion(
          chart_id,
          baseline_projection,
          LIB_PATH,
          this.updateValue,
          sc
        );
      },

      resize: function (width, height) {
        // TODO: code to re-render the widget with a new size
      },

      updateValue: function (type, data) {
        if (HTMLWidgets.shinyMode) {
          Shiny.setInputValue(elementId + "_" + type, data);
        }
      },
    };
  },
});
