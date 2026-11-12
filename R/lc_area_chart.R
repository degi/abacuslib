# Build the area chart widget from the supplied Abacus data.
#' Projected and observed land cover area chart
#'
#' Creates a standalone land cover area chart for an Abacus scenario or observed data.
#'
#' @param data An \code{abacus} object as returned by \code{abacus()} or \code{read.abacus()}.
#' @param scenario Optional scenario list.
#' @param selected_iteration Iteration highlighted in the chart. Default 1.
#' @param selected_zone Zone ID to display. Default 0 selects the first zone.
#' @param show_period_selection Logical. Show period selection controls and interactions. Default FALSE.
#' @param width Width of the widget. Default NULL (auto).
#' @param height Height of the widget. Default NULL (auto).
#' @param elementId Optional HTML element ID.
#'
#' @return An htmlwidget object containing the land cover area chart.
#' @import htmlwidgets
#' @import jsonlite
#' @export
lc_area_chart <- function(data,
                          scenario = NULL,
                          selected_iteration = 1,
                          selected_zone = 0,
                          show_period_selection = FALSE,
                          width = NULL,
                          height = NULL,
                          elementId = NULL) {
  x <- list(
    data = jsonlite::toJSON(data, force = TRUE),
    scenario = jsonlite::toJSON(scenario, force = TRUE),
    selected_iteration = selected_iteration,
    selected_zone = selected_zone,
    show_period_selection = show_period_selection
  )
  htmlwidgets::createWidget(
    name = "lc_area_chart",
    x,
    width = width,
    height = height,
    package = "abacuslib",
    elementId = elementId
  )
}

# Shiny output and render bindings for the area chart.
#' Shiny bindings for the land cover area chart
#'
#' @name lc_area_chart-shiny
#' @param outputId Output element ID.
#' @param width,height Widget dimensions.
#' @export
lc_area_chart_output <- function(outputId,
                                 width = "100%",
                                 height = "100%") {
  htmlwidgets::shinyWidgetOutput(
    outputId,
    "lc_area_chart",
    width,
    height,
    package = "abacuslib"
  )
}

#' @rdname lc_area_chart-shiny
#' @param expr An expression that generates a land cover area chart.
#' @param env Environment in which to evaluate \code{expr}.
#' @param quoted Whether \code{expr} is already quoted.
#' @export
render_lc_area_chart <- function(expr,
                                 env = parent.frame(),
                                 quoted = FALSE) {
  if (!quoted) expr <- substitute(expr)
  htmlwidgets::shinyRenderWidget(
    expr,
    lc_area_chart_output,
    env,
    quoted = TRUE
  )
}

