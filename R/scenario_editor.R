# Build the scenario editor widget and its Shiny bindings.
#' Projection scenario editor for REDD Abacus
#'
#' Creates an interactive htmlwidget that displays the REDD Abacus land cover
#' change projection and allows editing of emission reduction scenarios.
#'
#' @param data An \code{abacus} object as returned by \code{read.abacus} or \code{abacus()}.
#' @param scenario Optional scenario list. Default NULL.
#' @param selected_iteration Integer. Iteration number to display (default 1).
#' @param selected_zone Integer. Zone ID to display; 0 means all zones (default 0).
#' @param selected_lc Integer. Land cover ID to highlight; 0 means all (default 0).
#' @param editable Logical. Whether transitions can be edited (default TRUE). If FALSE,
#'   the widget operates in view-only mode without editing modal or inputs.
#' @param initial_view_mode Character. Initial view to display: \code{"bar"} (default) or \code{"matrix"}.
#' @param width Width of the widget. Must be a valid CSS unit (e.g. \code{'100\%'},
#'   \code{'600px'}) or a number coerced to pixels. Default NULL (auto).
#' @param height Height of the widget. Must be a valid CSS unit (e.g. \code{'400px'})
#'   or a number coerced to pixels. Default NULL (auto).
#' @param elementId Optional HTML element ID for the widget container. Default NULL.
#'
#' @return An htmlwidget object that renders the REDD Abacus scenario editor.
#' @import htmlwidgets
#' @import jsonlite
#'
#' @export
scenario_editor <- function(data,
                      scenario = NULL,
                      selected_iteration = 1,
                      selected_zone = 0,
                      selected_lc = 0,
                      editable = TRUE,
                      initial_view_mode = "bar",
                      width = NULL,
                      height = NULL,
                      elementId = NULL) {
  x = list(
    data = data,
    scenario = scenario,
    selected_iteration = selected_iteration,
    selected_zone = selected_zone,
    selected_lc = selected_lc,
    editable = editable,
    initial_view_mode = initial_view_mode
  )
  attr(x, "TOJSON_FUNC") <- function(val) {
    jsonlite::toJSON(val, force = TRUE, auto_unbox = TRUE)
  }
  # create widget
  htmlwidgets::createWidget(
    name = 'scenario_editor',
    x,
    width = width,
    height = height,
    package = 'abacuslib',
    elementId = elementId
  )
}

# Shiny output and render bindings for the scenario editor.
#' Shiny bindings for abacuslib
#'
#' Output and render functions for using abacuslib within Shiny
#' applications and interactive Rmd documents.
#'
#' @param outputId output variable to read from
#' @param width,height Must be a valid CSS unit (like \code{'100\%'},
#'   \code{'400px'}, \code{'auto'}) or a number, which will be coerced to a
#'   string and have \code{'px'} appended.
#' @param expr An expression that generates a abacuslib
#' @param env The environment in which to evaluate \code{expr}.
#' @param quoted Is \code{expr} a quoted expression (with \code{quote()})? This
#'   is useful if you want to save an expression in a variable.
#'
#' @name scenario_editor-shiny
#' @import htmlwidgets
#'
#' @export
scenario_editor_output <- function(outputId,
                            width = '100%',
                            height = '400px') {
  htmlwidgets::shinyWidgetOutput(outputId, 'scenario_editor', width, height, package = 'abacuslib')
}

#' @rdname scenario_editor-shiny
#' @import htmlwidgets
#' @export
render_scenario_editor <- function(expr,
                            env = parent.frame(),
                            quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  } # force quoted
  htmlwidgets::shinyRenderWidget(expr, scenario_editor_output, env, quoted = TRUE)
}
