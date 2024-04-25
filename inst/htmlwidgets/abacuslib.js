HTMLWidgets.widget({

  name: 'abacuslib',

  type: 'output',

  factory: function(el, width, height) {

    // TODO: define shared variables for this instance
    const IMAGE_LIB_LOCAL = "lib/d3-7.8.5/images/";
    const IMAGE_LIB_WEB = "https://raw.githubusercontent.com/degi/threeforest/main/inst/htmlwidgets/lib/images/";

      //API variables
      var elementId = el.id;
      var container = document.getElementById(elementId);
      var initialized = false;
    return {

      renderValue: function(x) {
        let LIB_PATH;
        if (HTMLWidgets.shinyMode) {
          LIB_PATH = IMAGE_LIB_WEB; 
        } else {
          LIB_PATH = IMAGE_LIB_LOCAL; 
        }

        const abacus_data = x.data;
        const baseline_projection = get_baseline_projection(abacus_data);
        let chart = document.createElement('div');
        chart.id = "luchart";
        el.appendChild(chart);
        show_lc_conversion(chart.id, baseline_projection, LIB_PATH, this.updateValue);
        
        // show_lc_conversion(el.id, baseline_projection);
      },

      resize: function(width, height) {

        // TODO: code to re-render the widget with a new size

      },

      updateValue: function(data) {
        if (HTMLWidgets.shinyMode) {
          Shiny.onInputChange(elementId + "_updated", data);
        }
      } 


    };
  }
});